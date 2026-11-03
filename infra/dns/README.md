# Local DNS setup

This is the optional external-ingress DNS path. The default named-access
experience uses [Portless host registration](../access/README.md) instead. Confirm the Kubernetes context, app
DNS suffix, host-reachable ingress IP, and installation scope before mutation.
This procedure currently targets macOS hosts. Other operating systems need their
own measured resolver setup; do not copy macOS paths onto them.

## Two different DNS paths

| Client | Names | DNS owner | Target |
| --- | --- | --- | --- |
| A Pod | Kubernetes Service names | The selected cluster's DNS, normally CoreDNS | Service or endpoint addresses |
| This Mac | App names rendered by Ground | A domain-specific macOS resolver and local dnsmasq | The ingress address reachable from this Mac |

Cluster DNS does not configure the Mac's resolver. A resolved app hostname does
not install an Ingress, create a listener, or establish TLS. Preserve the
cluster's existing service DNS zone; do not replace it with the app suffix.

## Generate project-scoped artifacts

The catalog starts with `ground.test`. Change `infra/addressing.local.yml` for
a machine-wide owned suffix, or set `addressing.tld` in a project profile for
its own domain. Clone overrides remain available. The complete precedence and
naming choices live in the [profile reference](../../skills/ground/references/runtime-profile.md#domain-configuration).

Each project supplies its host-reachable ingress IPv4 address. Multiple projects
can share one address or use different addresses and DNS domains. For example:

```sh
de-novo skills infra dns render \
  --project /path/to/acme --address 127.0.0.1 \
  --project /path/to/other --address 192.0.2.10 \
  --port 1053 --output /path/to/new-dns-artifacts --apply
```

These are illustrative paths and addresses, not measured defaults. Without
`--apply`, this command prints the plan and writes nothing. With it, the command
creates only a new artifact directory; an existing directory is refused. Its
parent must exist. `--json` returns the effective plan. The directory contains:

- `dnsmasq.conf`: project-zone rules for all supplied projects.
- `resolvers/<zone>`: one macOS domain resolver fragment per distinct zone.
- `manifest.json`: the source profiles, effective domains, targets, and plan.

Generation does not install a service, bind a port, write `/etc/resolver`, or
contact a cluster. A generated resolver for `acme.ground.test` affects that
subtree only; another project's domain can route to its own ingress. Conflicting
addresses for the same zone, reserved suffixes, and unsupported naming layouts
are rejected before any artifacts are written. IPv6 ingress targets are not yet
supported by this renderer; AAAA requests in an IPv4-only local zone return no data.

## Isolated acceptance check

```sh
npm run verify:dns
```

This explicit check builds a disposable image with dnsmasq and DNS query tools.
It renders temporary project profiles through the real CLI, then starts the DNS
process inside a container with no external network and no published host ports.
It measures UDP, TCP, missing IPv6 records, outside-zone refusal, and HTTP service
identity using those DNS answers. The runner prints the observed counts and
removes its own container, image tag, and temporary files. Docker build cache may
remain. It does not install a host resolver, start Kubernetes, or touch engines.

This measures the generated DNS rules, not macOS resolver integration, cluster
Service DNS, an ingress controller, or TLS. Those deployment checks below still
apply when installing on a real machine.

## Establish the target

1. Read the explicitly selected context with `kubectl --context <context>`.
   Observe nodes, the DNS deployment/Service, ingress controller, and its address.
   A kubeconfig entry is not evidence that the cluster is reachable.
2. Test the ingress address from the Mac using a known safe app path and the
   intended Host header. Do not guess loopback: it is valid only when a measured
   listener forwards that address into this cluster.
3. Store the app suffix in `infra/addressing.local.yml` for this clone, or in
   the consuming project's addressing profile. Do not use the multicast `.local`
   suffix or take over an unrelated existing resolver domain. Confirm conflicts
   against `scutil --dns`, `/etc/resolver`, and listening DNS sockets.
4. Confirm permission for package installation and the privileged resolver file.
   Do not overwrite another resolver, change default DNS, disable VPN DNS, or
   edit `/etc/resolv.conf`. Cluster selection and host resolver changes are
   separate targets of the authorized setup.

## Host DNS on macOS

Use the existing dnsmasq installation or install it through the machine's chosen
package manager within the agreed scope. Keep only generated, clone-local
artifacts in this directory; domain values remain in the addressing files; the manifest records the explicit
ingress address supplied for each project. Record their paths and revision on each generated file.

Generate the files with `infra dns render`, inspect the manifest and rules, and
run `dnsmasq --test --conf-file=<output>/dnsmasq.conf` before installation.

The local domain rule prevents other record types from leaking to an upstream
resolver. This dedicated instance answers only the local zone; the OS continues
using its existing resolvers for every other domain. Test the fragment using
`dnsmasq --test --conf-file=<file>` before starting the configured instance.
Use the machine's existing service manager to persist it; record the exact
service name and config path. Do not silently replace a running dnsmasq service.

For each generated zone, create the domain-specific file `/etc/resolver/<zone>` with the agreed
privileged installation mechanism, using its generated resolver fragment:

```conf
# Ground-managed; record the generated file's source and revision.
nameserver 127.0.0.1
port <same-DNS-port>
```

An existing file may be reused unchanged. A different existing file needs its
owner's explicit replacement decision. Keep its previous contents before any
approved change. Inspect `scutil --dns` after installation: the app suffix must
be routed to this resolver, with unrelated resolver configuration preserved.

## Verify before completing adoption

- Query dnsmasq directly with `dig @127.0.0.1 -p <port> <app-name> A` and a
  second name under another project. Both must return the intended ingress IP.
- Resolve those names through the OS, for example Node's `dns.lookup`, not just
  `dig`. `de-novo skills doctor --probe` uses the OS resolver for rendered names.
- Resolve a known unrelated name before and after setup to check existing DNS.
- From an approved diagnostic Pod in the explicitly selected context, resolve
  a known Kubernetes Service using the cluster's actual DNS zone. Existing
  CoreDNS is reused; a missing DNS service is an installation prerequisite.
- Request a safe application path by its new hostname and observe which app
  answered. Verify TLS separately if HTTPS is claimed.

Report direct DNS, OS DNS, cluster Service DNS, and app requests as separate
counts. A skipped boundary prevents claiming complete DNS setup. No live host
or cluster has been configured merely by writing this procedure.

## Recovery

If verification fails, restore only the resolver file and dedicated service
changed by this operation, using the recorded prior state. Preserve other DNS,
VPNs, data engines, and Kubernetes objects. Remove a newly created resolver only
when its contents still match the generated file. Then repeat the OS DNS and
unrelated-domain checks. There is no machine-infrastructure down command.

Sources: [Kubernetes service DNS](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/),
[dnsmasq configuration](https://dnsmasq.org/docs/dnsmasq-man.html), and the host's
`man 5 resolver` for macOS domain-specific resolvers and port configuration.
