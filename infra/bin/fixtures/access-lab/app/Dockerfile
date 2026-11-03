FROM node:24.22.0-bookworm
ARG REVISION
ENV REVISION=$REVISION
COPY app.mjs /app.mjs
CMD ["node", "/app.mjs"]
