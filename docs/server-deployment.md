# 私有部署与上线

部署目标是 Linux / Node.js 22+，项目目录 `/opt/our-little-planet`，以独立的 `planet` 用户运行。生产配置位于该目录的 `.env.local`，应仅允许服务器管理员与应用用户读取。

## 备案审核期间

使用 `deploy/our-little-planet.service` 启动，网站只监听 `127.0.0.1:3000`。不需要放行公网 3000 端口。通过自己的电脑建立 SSH 隧道预览：

```sh
ssh -N -L 127.0.0.1:3000:127.0.0.1:3000 -i /path/to/deployment-key root@服务器公网IP
```

保持终端运行，然后打开 `http://localhost:3000`。此页面实际运行在服务器上，通过 SSH 加密转发；确认浏览器接受 localhost 的 Secure cookie 后再记录内容。不要用公网明文 HTTP 传递正式口令。

安装前先恢复数据，再构建。Windows 的 `node_modules/`、`.next/` 不能直接当作 Linux 构建产物使用，应在服务器安装依赖并构建。

```sh
systemctl status our-little-planet --no-pager
journalctl -u our-little-planet -n 80 --no-pager
systemctl restart our-little-planet
```

## 每日备份

将 `deploy/our-little-planet-backup.service` 和 `.timer` 安装到 `/etc/systemd/system/`，创建归 `planet` 用户所有、权限为 `0700` 的 `/var/backups/our-little-planet`，然后：

```sh
systemctl daemon-reload
systemctl enable --now our-little-planet-backup.timer
systemctl start our-little-planet-backup.service
systemctl list-timers our-little-planet-backup.timer
```

每天北京时间 04:15 后五分钟内执行一次，生成后做完整性校验，新备份成功后才清理 14 天前的日备份。备份失败可在 `journalctl -u our-little-planet-backup` 查看原因。

这些备份仍在同一服务器上，**服务器到期前必须通过作者后台下载到自己的电脑**。当前没有配置自动异地同步；迁移流程见 [备份与换服务器](backup-and-migration.md)。

## 暂时关机与再次启动

在阿里云控制台正常停止实例，持久云盘上的记录、媒体和配置会保留。停机期间网站无法访问，定时备份也不会执行；包年到期日不因停机顺延。释放实例、删除云盘或重装系统不属于这里的正常关机操作。

当前部署的网站、每日备份定时器和流量保护服务都已启用开机启动。再次启动实例后，它们会自动恢复；备份定时器会补执行错过的任务，流量保护会延续当前月份的账本。确认实例为运行中后，在自己的电脑重新建立 SSH 隧道，即可继续通过 `http://localhost:3000` 预览。需要手动核查时执行：

```sh
systemctl is-active our-little-planet our-little-planet-traffic-guard our-little-planet-backup.timer
```

## 正式开放时

当前服务器已接入 CDT，并安装每月 15 GB 自动暂停与 10 Mbps 发送限速保护。上线前与迁移时须保留对应系统服务、月度账本及应用依赖配置，详见 [公网流量保护](traffic-protection.md)。CDT 免费额度为账号共享，本机保护不等于云端账单硬封顶。

备案通过后再配置域名解析、Nginx HTTPS、页脚备案号及链接。应用继续只监听本机，由 Nginx 转发，安全组只按需要放行 80/443。

备份接口可能需要较长时间准备文件，在 Nginx 中为 `/api/backup` 配置 `proxy_read_timeout 3600s` 和 `proxy_buffering off`。普通媒体上传限制也需按使用需求设定。正式密码、签名密钥和数据库均不能提交 Git。

### 域名、证书与备案号

在 DNS 中把根域名 `@` 和 `www` 的 A 记录指向服务器公网 IPv4，使用免费版解析即可。安全组开放 TCP 80 和 443，保留原有 SSH 规则；3000 端口继续只监听本机。

安装 Nginx 和 Certbot，创建 `/var/www/planet-acme/.well-known/acme-challenge`，并保证这些目录权限为 `0755`。首次签发前，启用替换过域名的 `deploy/nginx-acme.conf.example`，移除默认欢迎页配置，并通过 `nginx -t`。此时 80 端口只提供 ACME 验证目录。

```sh
certbot certonly --webroot -w /var/www/planet-acme \
  --cert-name example.com -d example.com -d www.example.com \
  --non-interactive --agree-tos --register-unsafely-without-email
```

也可以用 `--email 自己的邮箱` 替换不登记邮箱的选项。证书签发完成后，换成 `deploy/nginx.conf.example` 并测试、重载 Nginx。此配置适用于 Nginx 1.25.1+，把 HTTP 和 `www` 统一跳转到根域名 HTTPS，保留流式响应，为备份设置一小时等待时间，并限制登录接口的重复尝试。

将 `deploy/renew-certificate.sh` 安装到 `/etc/letsencrypt/renewal-hooks/deploy/` 并设为可执行，启用 `certbot.timer`。用 `certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew` 验证续签和重载；签发和续签无需购买阿里云证书套餐。

在服务器 `.env.local` 配置 `ICP_RECORD_NUMBER=自己的完整网站备案号`，重启应用后页脚显示号码并链接 `https://beian.miit.gov.cn/`。这是运行时配置，号码变更不需要重新构建。上线后继续办理公安联网备案，审核通过后再添加对应备案信息。
