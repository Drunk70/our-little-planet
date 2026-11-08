#!/usr/bin/env python3
"""Local outbound quota. This is not a cloud-provider billing cap.

Reserve small byte grants on disk BEFORE handing them to nftables. A crash can
waste the unused part of a grant, but cannot issue the same grant twice. The
kernel enforces the current grant even if this process stops or hangs.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

TABLE = "planet_guard"
DEFAULT_CONFIG = {
    "monthly_bytes": 15_000_000_000,
    "grant_bytes": 64 * 1024 * 1024,
    "rescue_monthly_bytes": 64 * 1024 * 1024,
    "rescue_grant_bytes": 512 * 1024,
    "application": "our-little-planet.service",
}


def month_now():
    return datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m")


def run(args, text=None):
    return subprocess.run(args, input=text, text=True, capture_output=True,
                          check=True, timeout=8).stdout


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", encoding="utf-8") as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def empty_state(month, initial=0, paused=False):
    return {"version": 1, "month": month, "normal_reserved": initial,
            "rescue_reserved": 0, "normal_name": "", "rescue_name": "",
            "paused_by_guard": paused}


def validate_state(state):
    if state.get("version") != 1 or not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", state.get("month", "")):
        raise ValueError("Invalid quota state version/month; refusing to reset")
    for key in ("normal_reserved", "rescue_reserved"):
        if type(state.get(key)) is not int or state[key] < 0:
            raise ValueError("Invalid persisted byte allowance")
    for key in ("normal_name", "rescue_name"):
        if not re.fullmatch(r"(?:[nr]_[a-f0-9]{16})?", state.get(key, "")):
            raise ValueError("Invalid quota identifier")
    if type(state.get("paused_by_guard")) is not bool:
        raise ValueError("Invalid pause state")


def exempt_rules():
    # VPC/local control-plane traffic is not Internet egress. All other
    # interfaces, IPv4 AND IPv6, including forwarded/container traffic, count.
    return [
        'oifname "lo" return',
        'ip daddr { 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10, 169.254.0.0/16, 224.0.0.0/4, 255.255.255.255 } return',
        'ip6 daddr { ::1, fc00::/7, fe80::/10, ff00::/8 } return',
    ]


def outgoing_rules(normal=None, rescue=None):
    rules = exempt_rules()
    if normal:
        rules.append(f'quota name "{normal}" accept')
    if rescue:
        rules.append(f'tcp sport 22 limit rate 16 kbytes/second burst 32 kbytes quota name "{rescue}" accept')
    rules.append("counter drop")
    return rules


def table_rules(normal=None, rescue=None, normal_bytes=0, rescue_bytes=0):
    quotas = []
    if normal:
        quotas.append(f'quota {normal} {{ until {normal_bytes} bytes; }}')
    if rescue:
        quotas.append(f'quota {rescue} {{ until {rescue_bytes} bytes; }}')
    lines = [f"destroy table inet {TABLE}", f"table inet {TABLE} {{", *quotas,
             "chain outgoing { type filter hook postrouting priority 100; policy accept;",
             *outgoing_rules(normal, rescue), "}",
             "chain incoming { type filter hook input priority -10; policy accept;",
             'iifname "lo" return',
             "tcp dport { 80, 443 } tcp flags & (fin | syn | rst | ack) == syn limit rate over 30/second burst 60 packets drop",
             "}", "}"]
    return "\n".join(lines) + "\n"


class Kernel:
    def quotas(self):
        # Missing table is distinguishable from a broken nft invocation.
        tables = json.loads(run(["nft", "-j", "list", "tables"]))["nftables"]
        if not any(x.get("table", {}).get("name") == TABLE and x["table"]["family"] == "inet" for x in tables):
            return {}
        data = json.loads(run(["nft", "-j", "list", "table", "inet", TABLE]))
        return {x["quota"]["name"]: x["quota"] for x in data["nftables"] if "quota" in x}

    def install(self, state, sizes):
        run(["nft", "-f", "-"], table_rules(state["normal_name"], state["rescue_name"], *sizes))

    def replace(self, old_name, kind, state, size):
        # One atomic nft transaction: no unprotected interval, and the other
        # quota object keeps counting without resetting its maintenance budget.
        new_name = state[f"{kind}_name"]
        commands = [f"flush chain inet {TABLE} outgoing",
                    f"delete quota inet {TABLE} {old_name}",
                    f"add quota inet {TABLE} {new_name} {{ until {size} bytes; }}"]
        commands += [f"add rule inet {TABLE} outgoing {r}"
                     for r in outgoing_rules(state["normal_name"], state["rescue_name"])]
        run(["nft", "-f", "-"], "\n".join(commands) + "\n")

    def close(self):
        run(["nft", "-f", "-"], table_rules())


class Guard:
    def __init__(self, path, config, kernel=None):
        self.path = Path(path)
        self.config = config
        self.kernel = kernel or Kernel()
        self.state = json.loads(self.path.read_text(encoding="utf-8"))
        validate_state(self.state)

    def save(self):
        atomic_json(self.path, self.state)

    def reserve(self, kind):
        limit = self.config["monthly_bytes" if kind == "normal" else "rescue_monthly_bytes"]
        chunk = self.config["grant_bytes" if kind == "normal" else "rescue_grant_bytes"]
        size = min(chunk, max(0, limit - self.state[f"{kind}_reserved"]))
        self.state[f"{kind}_reserved"] += size
        self.state[f"{kind}_name"] = kind[0] + "_" + uuid.uuid4().hex[:16]
        # Disk commit always precedes the kernel grant.
        self.save()
        return size

    def tick(self, month=None):
        month = month or month_now()
        if month < self.state["month"]:
            raise RuntimeError("Clock moved backwards across a month; refusing extra allowance")
        if month > self.state["month"]:
            # Close before resetting the ledger; a crash cannot use both months.
            self.kernel.close()
            self.state = empty_state(month, paused=self.state["paused_by_guard"])
            self.save()
        quotas = self.kernel.quotas()
        if any(self.state[f"{k}_name"] not in quotas for k in ("normal", "rescue")):
            self.kernel.close()
            sizes = [self.reserve(k) for k in ("normal", "rescue")]
            self.kernel.install(self.state, sizes)
            quotas = self.kernel.quotas()
        for kind in ("normal", "rescue"):
            name = self.state[f"{kind}_name"]
            quota = quotas[name]
            limit = self.config["monthly_bytes" if kind == "normal" else "rescue_monthly_bytes"]
            if quota["used"] >= quota["bytes"] and self.state[f"{kind}_reserved"] < limit:
                size = self.reserve(kind)
                self.kernel.replace(name, kind, self.state, size)
        quotas = self.kernel.quotas()
        result = {"month": month, "checked_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
                  "limit_bytes": self.config["monthly_bytes"]}
        for kind in ("normal", "rescue"):
            quota = quotas[self.state[f"{kind}_name"]]
            remaining = max(0, quota["bytes"] - quota["used"])
            result[f"{kind}_accounted_bytes"] = self.state[f"{kind}_reserved"] - remaining
            result[f"{kind}_reserved_bytes"] = self.state[f"{kind}_reserved"]
        result["blocked"] = result["normal_accounted_bytes"] >= self.config["monthly_bytes"]
        return result

    def sync_application(self, blocked):
        application = self.config["application"]
        active = run(["systemctl", "show", application, "--property=ActiveState", "--value"]).strip()
        if blocked and active in ("active", "activating", "reloading"):
            # Set durable ownership first so a crash during stop can be resumed.
            self.state["paused_by_guard"] = True
            self.save()
            run(["systemctl", "stop", "--no-block", application])
            print("Monthly outbound quota reached; website paused", flush=True)
        elif not blocked and self.state["paused_by_guard"]:
            run(["systemctl", "start", "--no-block", application])
            self.state["paused_by_guard"] = False
            self.save()
            print("Monthly outbound quota available; website resumed", flush=True)


def notify(message):
    address = os.environ.get("NOTIFY_SOCKET")
    if address:
        if address.startswith("@"):
            address = "\0" + address[1:]
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.sendto(message.encode(), address)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("init", "run", "status", "closed-rules"))
    parser.add_argument("--state", default="/var/lib/planet-traffic-guard/state.json")
    parser.add_argument("--config", default="/etc/planet-traffic-guard/config.json")
    parser.add_argument("--initial-used-bytes", type=int, default=0)
    args = parser.parse_args()
    if args.command == "closed-rules":
        print(table_rules(), end="")
        return
    config = dict(DEFAULT_CONFIG)
    config.update(json.loads(Path(args.config).read_text(encoding="utf-8")))
    for key in ("monthly_bytes", "grant_bytes", "rescue_monthly_bytes", "rescue_grant_bytes"):
        if type(config[key]) is not int or config[key] <= 0:
            raise ValueError(f"Invalid {key}")
    state_path = Path(args.state)
    if args.command == "init":
        if state_path.exists() or args.initial_used_bytes < 0:
            raise ValueError("Refusing to overwrite the existing monthly ledger")
        atomic_json(state_path, empty_state(month_now(), args.initial_used_bytes))
        return
    if args.command == "status":
        print(state_path.with_name("status.json").read_text(encoding="utf-8"))
        return
    # Only one daemon may grant bytes. Missing/corrupt state must never reset it.
    state_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(state_path.with_name("guard.lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            guard = Guard(state_path, config)
            ticks = 0
            last_blocked = None
            while True:
                status = guard.tick()
                guard.sync_application(status["blocked"])
                if ticks % 15 == 0 or last_blocked != status["blocked"]:
                    atomic_json(state_path.with_name("status.json"), status)
                last_blocked = status["blocked"]
                notify("READY=1\nWATCHDOG=1")
                ticks += 1
                time.sleep(1)
        except BaseException:
            # Never remove enforcement on stop/error. An administrator can
            # recover through Alibaba's private-network Workbench channel.
            Kernel().close()
            raise


if __name__ == "__main__":
    main()
