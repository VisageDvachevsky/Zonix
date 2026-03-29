FROM postgres:15-alpine

USER root

RUN apk add --no-cache bind bind-tools

COPY config/named.conf /etc/bind/named.conf
COPY config/zonix-key.conf /etc/bind/zonix-key.conf
COPY zones /var/lib/bind/zones

RUN mkdir -p /var/cache/bind /var/run/named /var/lib/bind/zones \
    && chmod -R 755 /var/cache/bind /var/run/named /var/lib/bind /etc/bind

EXPOSE 53/tcp 53/udp

CMD ["named", "-4", "-g", "-u", "root", "-c", "/etc/bind/named.conf"]
