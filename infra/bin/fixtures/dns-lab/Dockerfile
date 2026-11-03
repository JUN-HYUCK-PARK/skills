FROM node:24.22.0-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends dnsmasq-base dnsutils && rm -rf /var/lib/apt/lists/*
CMD ["node", "/lab/check.mjs"]
