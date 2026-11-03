# Glossary

| Term | Meaning |
| --- | --- |
| Ground | The shared local development base: project runtime values, addressing, and engine isolation |
| Baseline | The project's designated app runtime |
| Machine infrastructure | The engine set shared by projects using this catalog's backend |
| Overlay | An optional separate instance of changed services, managed through the project's adapter |

Application workloads require Kubernetes and measured DNS.

The project profile is `.agents/runtime-profile.yml`. Machine commands use
`de-novo skills infra`; the backend remains optional. Kubernetes engine linking
is `infra k3d`, with an explicitly named cluster.
