#!/usr/bin/env python3
"""Run with: unshare -n python3 test-traffic-guard.py (root, no live network)."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("traffic_guard", Path(__file__).with_name("traffic-guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class TrafficGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.readlink('/proc/self/ns/net') == os.readlink('/proc/1/ns/net'):
            raise RuntimeError('Refusing to test in the host network; use unshare -n')
        # The outer unshare isolates the host. A second namespace is a fake
        # Internet peer; every test packet stays inside this disposable pair.
        cls.peer = subprocess.Popen(["unshare", "-n", "sleep", "300"])
        import time
        time.sleep(0.15)
        cls.ns = ["nsenter", "-t", str(cls.peer.pid), "-n"]
        guard.run(["ip", "link", "set", "lo", "up"])
        guard.run(["ip", "link", "add", "quota_test", "type", "veth", "peer", "name", "quota_peer"])
        guard.run(["ip", "link", "set", "quota_peer", "netns", str(cls.peer.pid)])
        guard.run(["ip", "addr", "add", "198.18.0.1/30", "dev", "quota_test"])
        guard.run(["ip", "addr", "add", "2001:db8::1/64", "dev", "quota_test", "nodad"])
        guard.run(["ip", "link", "set", "quota_test", "up"])
        guard.run(cls.ns + ["ip", "addr", "add", "198.18.0.2/30", "dev", "quota_peer"])
        guard.run(cls.ns + ["ip", "addr", "add", "2001:db8::2/64", "dev", "quota_peer", "nodad"])
        guard.run(cls.ns + ["ip", "link", "set", "quota_peer", "up"])

    @classmethod
    def tearDownClass(cls):
        cls.peer.terminate()
        cls.peer.wait()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state.json"
        self.config = dict(guard.DEFAULT_CONFIG, monthly_bytes=12_000, grant_bytes=4_000,
                           rescue_monthly_bytes=2_000, rescue_grant_bytes=1_000)
        guard.atomic_json(self.path, guard.empty_state("2026-11"))
        guard.Kernel().close()
        self.g = guard.Guard(self.path, self.config)

    def tearDown(self):
        guard.Kernel().close()
        self.temp.cleanup()

    def packets(self, v6=False):
        family, addr = (socket.AF_INET6, "2001:db8::2") if v6 else (socket.AF_INET, "198.18.0.2")
        with socket.socket(family, socket.SOCK_DGRAM) as sock:
            blocked = 0
            for _ in range(20):
                try:
                    sock.sendto(b"x" * 1000, (addr, 9999))
                except PermissionError:
                    blocked += 1
            self.assertGreater(blocked, 0, "Kernel must reject packets after allowance is spent")

    def test_ipv4_ipv6_enforcement_restart_and_month_rollover(self):
        status = self.g.tick("2026-11")
        self.assertFalse(status["blocked"])
        self.packets()
        name = self.g.state["normal_name"]
        self.assertGreaterEqual(self.g.kernel.quotas()[name]["used"], 4000)
        # Neither a dead daemon nor more requests can refill a grant.
        self.packets(v6=True)
        self.assertEqual(self.g.state["normal_reserved"], 4000)
        self.g.tick("2026-11")
        self.packets(v6=True)
        self.g.tick("2026-11")
        self.packets()
        self.assertTrue(self.g.tick("2026-11")["blocked"])
        self.assertTrue(guard.Guard(self.path, self.config).tick("2026-11")["blocked"])
        # Reboot/table loss cannot reset a spent monthly allowance.
        self.g.kernel.close()
        self.assertTrue(guard.Guard(self.path, self.config).tick("2026-11")["blocked"])
        self.g = guard.Guard(self.path, self.config)
        self.assertFalse(self.g.tick("2026-12")["blocked"])
        with self.assertRaises(RuntimeError):
            self.g.tick("2026-11")

    def test_crash_after_reservation_cannot_double_grant(self):
        self.g.tick("2026-11")
        self.g.reserve("normal")  # Simulated disk commit then process death.
        restarted = guard.Guard(self.path, self.config)
        restarted.tick("2026-11")
        self.assertEqual(restarted.state["normal_reserved"], 12_000)
        self.packets()
        self.assertTrue(restarted.tick("2026-11")["blocked"])

    def test_corrupt_or_missing_state_never_gets_new_allowance(self):
        self.path.write_text('{"version":1}', encoding="utf-8")
        with self.assertRaises(ValueError):
            guard.Guard(self.path, self.config)
        self.path.unlink()
        with self.assertRaises(FileNotFoundError):
            guard.Guard(self.path, self.config)

    def test_refill_preserves_other_quota_and_atomic_drop_rule(self):
        self.g.tick("2026-11")
        rescue_name = self.g.state["rescue_name"]
        before = self.g.kernel.quotas()[rescue_name]
        self.packets()
        self.g.tick("2026-11")
        self.assertEqual(self.g.state["rescue_name"], rescue_name)
        self.assertEqual(self.g.kernel.quotas()[rescue_name], before)
        rules = json.loads(guard.run(["nft", "-j", "list", "table", "inet", guard.TABLE]))
        self.assertTrue(any("drop" in expr for row in rules["nftables"]
                            for expr in row.get("rule", {}).get("expr", [])))

    def test_pause_resume_does_not_start_a_manually_stopped_site(self):
        self.g.tick("2026-11")
        calls = []
        active = "active"

        def systemctl(args, text=None):
            nonlocal active
            calls.append(args)
            if args[1] == "show":
                return active
            active = "inactive" if args[1] == "stop" else "active"
            return ""

        with patch.object(guard, "run", side_effect=systemctl):
            self.g.sync_application(True)
            self.assertEqual(active, "inactive")
            restarted = guard.Guard(self.path, self.config)
            self.assertTrue(restarted.state["paused_by_guard"])
            restarted.sync_application(False)
            self.assertEqual(active, "active")
            self.assertFalse(restarted.state["paused_by_guard"])
            active = "inactive"
            calls.clear()
            restarted.sync_application(False)
            self.assertFalse(any(call[1] == "start" for call in calls))

    def test_public_ssh_recovery_is_counted_and_not_unlimited(self):
        # Exhaust the normal allowance, then exercise a real TCP/22 connection
        # entirely within the two isolated namespaces.
        self.g.tick("2026-11")
        for _ in range(3):
            self.packets()
            self.g.tick("2026-11")
        self.assertTrue(self.g.tick("2026-11")["blocked"])
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind(("198.18.0.1", 22))
            listener.listen()
            listener.settimeout(3)
            client = subprocess.Popen(self.ns + ["python3", "-c",
                "import socket; s=socket.create_connection(('198.18.0.1',22),2); s.settimeout(2); "
                "\ntry:\n while s.recv(65536): pass\nexcept TimeoutError: pass"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                connection, _ = listener.accept()
                with connection:
                    connection.settimeout(0.3)
                    try:
                        connection.sendall(b"m" * 20_000)
                    except (TimeoutError, PermissionError):
                        pass
                quota = self.g.kernel.quotas()[self.g.state["rescue_name"]]
                self.assertGreaterEqual(quota["used"], quota["bytes"])
                self.g.tick("2026-11")
                self.assertEqual(self.g.state["rescue_reserved"], 2000)
            finally:
                client.terminate()
                client.wait()


if __name__ == "__main__":
    unittest.main(verbosity=2)
