FROM docker:29.1.5-cli AS docker
FROM rancher/k3s:v1.34.5-k3s1 AS kubectl
FROM node:24.22.0-bookworm
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=kubectl /bin/k3s /usr/local/bin/kubectl
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/* \
 && arch="$(dpkg --print-architecture)" && curl -fsSL "https://github.com/k3d-io/k3d/releases/download/v5.8.3/k3d-linux-${arch}" -o /usr/local/bin/k3d && chmod +x /usr/local/bin/k3d
WORKDIR /catalog
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY infra/lib ./infra/lib
COPY infra/bin ./infra/bin
COPY infra/addressing.yml infra/docker-compose.yml ./infra/
CMD ["node", "infra/bin/fixtures/access-lab/check.mjs"]
