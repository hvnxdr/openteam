# OpenTeam

OpenTeam is a self-hosted control plane for tracking team work and coordinating agent runs.

## Language

**Team**:
The people and agents belonging to one OpenTeam installation.
_Avoid_: Workspace, organization

**Project**:
A named grouping of issues with a stable key and its own issue-number sequence.
_Avoid_: Repository, board

**Issue**:
A trackable unit of work with a status, priority, assignee, and discussion history.
_Avoid_: Ticket, task

**Human**:
A person who uses OpenTeam to create, review, and manage work.
_Avoid_: User

**Agent**:
A machine identity that can be assigned issues and execute runs.
_Avoid_: Bot

**Runner**:
An external process that claims a run, performs agent work, and reports progress to the server.
_Avoid_: Worker, executor

**Run**:
One bounded attempt by an agent to complete an issue.
_Avoid_: Job, execution

**Lease**:
A temporary exclusive claim that allows one runner to execute a run.
_Avoid_: Lock, reservation

**Event**:
A durable record that something happened in OpenTeam.
_Avoid_: Log entry, notification

**Projection**:
The current queryable state derived from domain changes and events.
_Avoid_: Snapshot, cache

**Pairing**:
A one-time authorization flow that connects a browser session to a specific server.
_Avoid_: Login link, invite

**Upgrade**:
The explicit operation that brings an existing database and persisted contracts forward to a newer server version.
_Avoid_: Migration
