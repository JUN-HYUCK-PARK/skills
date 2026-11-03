# Named Kubernetes development access

Ground connects the project's existing deployment procedure to a Kubernetes
Service and a shared Portless gateway. A successful foreground session prints a
working named URL. The public proxy, HTTPS certificates, WebSocket forwarding,
and managed host entries come from the pinned Portless dependency; Ground does
not implement another proxy or DNS server.

## One-time machine bootstrap

Copy `infra/gateway.example.yml` to `infra/gateway.local.yml`. Confirm its listener
is free and its suffixes are approved. Start the gateway explicitly:

```sh
de-novo skills infra gateway start --config infra/gateway.local.yml
de-novo skills infra gateway start --config infra/gateway.local.yml --apply
```

The first command prints a plan. The second runs the pinned Portless proxy in
the foreground. It may request operating-system privileges to bind the chosen
port, install its CA, and maintain its own `/etc/hosts` block. This is an explicit
machine operation, separate from routine app sessions. Existing listeners are
never stopped or taken over. Leave the gateway running across project sessions.

To persist it at boot, use Portless's existing `service install` procedure with
the same port, TLS mode, TLDs, and `PORTLESS_STATE_DIR` as this file. This wrapper
does not install an OS service. Privilege and certificate trust are handled by
Portless's own flow. Browser trust remains a deployment check on each real OS;
a Node probe with the configured CA does not prove every browser trusts it.

Config values:

| Key | Meaning |
| --- | --- |
| `port` | Required explicit listener; no implicit bind to 80 or 443 |
| `https` | Defaults to true; false is an explicit HTTP choice |
| `tlds` | Non-empty approved suffix list; include project-owned domains here |
| `state_dir` | Required Portless state path, relative to this config file or absolute |
| `ca_file` | Optional probe trust anchor, otherwise `ca.pem` inside the state directory |

Keep the config, state, CA private keys, and generated files clone-local and
ignored by Git. The example uses `infra/portless.local/`, ignored by this catalog.
Custom state paths need their own ignore rule. Ground passes this exact state
path to Portless and uses its public `RouteStore` API for session-owned routes.
Adding a new suffix is an explicit bootstrap change; app startup will not restart
a shared proxy to change its configuration.

## Project values

Select `addressing.proxy: portless`, a Kubernetes context and namespaces, a safe
health path, and the Kubernetes Service mapping for each exposed entrypoint.
The [profile reference](../../skills/ground/references/runtime-profile.md#named-access-values)
owns those fields. Keep the project's existing `runtime.commands.up` command;
it must deploy the baseline and return. Ground runs it without a shell, with
`GROUND_KUBE_CONTEXT`, `GROUND_KUBE_NAMESPACE`, and a temporary private
`KUBECONFIG` pinned to the selected context. No user kubeconfig is changed.
Commands that explicitly choose another target remain the project's responsibility.

Domain precedence is unchanged: clone, project, machine, catalog fallback. Named
access registers the full resulting hostname, including a project's owned suffix.
Portless synchronizes only registered names to loopback, so this mode needs no
separate dnsmasq installation. Existing DNS/resolver overrides must agree with
loopback routing; readiness refuses names resolving elsewhere. The independent
[DNS artifact renderer](../dns/README.md) remains available for projects using
an external ingress address instead of this Portless mode.

## Run an entrypoint

```sh
de-novo skills dev web --project /path/to/project
de-novo skills dev web --project /path/to/project --apply
```

The first prints the target and URL without mutations. The second:

1. Checks the explicit gateway opt-in, selected Kubernetes target, approved
   suffix, Service mapping, and unclaimed hostname.
2. Acquires a session lock and a short baseline deployment-writer lock, then
   runs the project's deployment command. Other baseline readers remain valid.
3. Starts `kubectl port-forward` on an OS-selected loopback port. The user does
   not choose or manage this port. The public URL stays stable across restarts.
4. Registers the hostname with Portless under the session PID.
5. Resolves it through the OS and requests the safe health path over the named
   URL. HTTPS verifies the certificate; a healthy Portless response is required.
6. Prints `ready` only after that path succeeds, then remains in the foreground.

`--json` emits JSON-line `ready` and `cleanup` events. Diagnostics go to stderr.
`--timeout` sets per-command deployment/cleanup and public-readiness deadlines
in milliseconds. Allow enough time for Kubernetes namespace deletion. HTTP(S) readiness
is currently supported; TCP-only workloads stay with their existing procedures.
No Ingress controller is required for this host-access path. Cluster-to-cluster
Service traffic still uses CoreDNS and Kubernetes Service addresses.

## Run an overlay

```sh
de-novo skills dev web --project /path/to/project --env feature-a \
  --image registry.example.com/web:<full-git-sha> --apply
```

Only services enabled by the overlay contract are eligible. The environment must
be fresh both in the registry and the adapter's observed inventory. Ground calls
its existing `create` and `attach` gates, waits for the requested image/readiness,
then forwards the explicitly mapped overlay namespace. The adapter must deploy
there. DNS and connection registration do not implement Kubernetes deployment.
Unchanged dependencies must explicitly reference baseline Services; there is no
namespace DNS fallback. One session owns the environment's cleanup.

## Exit and recover

Ctrl-C/SIGTERM removes only the caller-owned route and port-forward. A newly
created overlay is destroyed through the existing lifecycle gate. Baseline apps,
data engines, other sessions and the shared gateway stay running. Failed public
readiness also removes the route/forward and attempts owned-overlay cleanup.
If cleanup fails too, diagnostics retain both failures. Pending overlay failures
remain visible for normal lifecycle recovery.

Session locks are under `ground-dev-locks` inside the configured Portless state
directory. Unexpected process death may leave a lock, temporary kubeconfig or
tracked overlay. Inspect the recorded PID, context, namespace and overlay status
before removing an abandoned lock/config. Live owners are never evicted; there
is no force takeover. Portless filters dead-PID routes. Shared actors outside
this local lock mechanism still follow the project's runtime ownership procedure.

## Measured acceptance

```sh
npm run verify:access
```

The explicit acceptance runner builds temporary images and an isolated k3s cluster
with k3d. It runs real deployment, Service port-forwarding, Portless HTTPS and
host synchronization, a baseline, two concurrent overlays, and a project-owned
domain. It checks distinct running images, selective overlay removal, failed
overlay readiness while another remains active, refused cleanup and lifecycle
recovery, explicit cross-namespace Service
access, context pinning, WebSocket upgrade, duplicate refusal, and cleanup of
routes, names, forwarders, locks, and temporary credentials. Counts come from
the runner. Only container-local hosts and trust stores change; no Mac resolver,
CA store, kubeconfig, existing cluster or shared data engine is modified. Docker
images and build cache may be downloaded. The runner removes its own cluster,
containers and image tags; it does not prune shared images or caches.

Portless source and operating instructions: [vercel-labs/portless](https://github.com/vercel-labs/portless).
