#!/bin/sh
# Certbot 成功续签后才执行；配置有误时保留正在运行的 Nginx。
set -eu
/usr/sbin/nginx -t
/usr/bin/systemctl reload nginx
