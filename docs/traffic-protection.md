# CDT 与服务器出网保护

2026-11-08 已在阿里云控制台确认 ECS 升级为 CDT 计费。中国内地每月 20 GB 的公网流量免费额度是**账号下适用资源共享**，不是每台服务器独享；超出后仍按云厂商规则收费。切换之前产生的费用不因切换而取消，账单有延迟。

这台服务器增加了本地流量保护，降低意外消耗的风险。**它不是阿里云提供的账单硬封顶，也不保证绝对零费用。** 云端计量、同账号其他资源、云服务费用、系统故障或管理员关闭保护都不受这套本机额度完全约束。

## 当前行为

- 普通公网出网保护阈值为每个北京时间自然月 **15,000,000,000 字节（15 GB）**。
- 在内核网络出口统一计量 IPv4、IPv6 和转发流量，包括网站、SSH 预览、备份下载、其他程序的公网发送。排除本机回环和列明的内网目标地址。
- 达到阈值时丢弃普通公网出网数据，自动停止 `our-little-planet.service`。网页可能显示连接超时；不持续返回耗流量的提示页面。文件与数据库保留，服务器仍运行，磁盘上的每日备份继续执行。
- 若网站是被保护程序暂停的，下月北京时间 1 日 00:00 后自动恢复；用户自己停掉的网站不会因此自动启动。
- 公网 SSH 留有单独的 **64 MiB/月**维护额度，限制为约 **16 KiB/s**，用于检查和恢复。维护额度也用尽后，使用阿里云内网 Workbench/云助手。大型备份不能依赖这条受限通道。
- `eth0` 的总发送速率通过 `tc` 限制为 **10 Mbps**，图片、视频和备份下载会受到这一速度限制。HTTP/HTTPS 新建 TCP 连接另有总计 30 次/秒、突发 60 次的限制，不能代替应用层反刷措施。
- 首次启用时保守预记 **0.10 GB**，覆盖当前启动期间已发生的少量流量。这是本地保护账本的预留，**不是阿里云扣费金额**。

## 为什么重启不会清零

状态文件 `/var/lib/planet-traffic-guard/state.json` 是月度账本。程序先把小段额度持久写入磁盘，再交给 nftables 执行；每段普通额度最多 64 MiB，维护额度最多 512 KiB。额度用尽后程序按剩余月度预算发放下一段。

网络出口的内核规则独立于保护进程。进程崩溃时，内核最多继续消耗已发放的有限额度，不会因监控程序退出就无限放行。普通流量每次用尽小段额度时，可能有不超过正常轮询间隔（约 1 秒）的短暂停顿。

进程重启会接续现存的内核配额；服务器重启或内核表丢失时，未用完的小段额度也按已占用处理，因此可能提前暂停，但不会重新获得整个 15 GB。缺失或损坏的账本不会自动初始化为零。系统跨月回拨时会停止发放新额度，等待修复。

开机引导服务在网络启动前安装默认阻断公网的规则，再由主保护服务按持久账本放行。需要保留这两项服务及应用的依赖配置。

## 查看状态

```sh
python3 /usr/local/sbin/planet-traffic-guard.py status
systemctl status our-little-planet-traffic-guard --no-pager
journalctl -u our-little-planet-traffic-guard -n 50 --no-pager
nft list table inet planet_guard
tc qdisc show dev eth0
```

`normal_accounted_bytes` 为本地保守计量用量，`blocked` 表示是否到达暂停阈值。状态展示约每 15 秒更新，实际数据包拦截由内核即时执行，不等待状态展示或云端账单。

应用代码在 `/opt/our-little-planet`，保护程序安装在 `/usr/local/sbin/planet-traffic-guard.py`，参数在 `/etc/planet-traffic-guard/config.json`。保护程序使用独立的 `inet planet_guard` 表，不清空其他防火墙规则。不要运行 `nft flush ruleset`，也不要删除账本来“恢复额度”。

部署源文件位于 `deploy/traffic-guard.py`、`deploy/traffic-guard-config.json` 和两项 `our-little-planet-traffic-*.service`。`deploy/our-little-planet-traffic-dependency.conf` 安装为 `/etc/systemd/system/our-little-planet.service.d/30-traffic-guard.conf`。默认阻断规则通过 `python3 /usr/local/sbin/planet-traffic-guard.py closed-rules` 生成至 `/etc/planet-traffic-guard/closed.nft`。部署时先安装配置和账本，再启用、启动引导与保护服务；远程修改网络规则必须预备定时回退，确认新 SSH 连接成功后撤销回退。

## 换服务器

网站后台的数据备份**不包含流量保护状态与系统服务**。迁移时除了恢复网站数据，还需要重新安装保护程序、两项 systemd 服务和应用依赖配置，并核对新服务器实际出口网卡（当前是 `eth0`）。

同账号当月免费额度是共享的。切换服务器前停止旧站对外服务，保留其月度用量记录；新服务器按同月已经消耗的额度继续保护，不能简单初始化为零。更稳妥的是复制旧服务器的账本，由新服务器将旧账本尚未用完的小段额度也保守计入。新账号或不同计费方案则按新的云端额度重新评估。

如果只是重装保护程序，保留 `/var/lib/planet-traffic-guard/`。初始化命令拒绝覆盖已存在账本。需要临时解除保护时，先检查云端剩余额度与可能的费用，再由管理员操作；不自动充值、不自动购买流量包。

## 验证

隔离网络测试使用虚拟网卡，不向互联网发送测试流量，不动线上网站的月度额度：

```sh
sudo unshare -n python3 deploy/test-traffic-guard.py
```

测试覆盖 IPv4/IPv6 耗尽拦截、进程重启、模拟重启丢失内核状态、跨月恢复、时钟回拨、账本损坏、磁盘提交后崩溃、有限 SSH 维护通道，以及只恢复由保护程序暂停的网站。
