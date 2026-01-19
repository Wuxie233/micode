# System Overview

Micode is an OpenCode plugin written in TypeScript for the Bun runtime. It provides tool definitions, agent workflows, and hooks that integrate with Octto sessions, mindmodel generation, and artifact indexing. Data is loaded primarily from YAML manifests and validated with valibot schemas, while local persistence uses bun:sqlite. Operational workflows include mindmodel generation, constraint enforcement, and milestone artifact indexing.
