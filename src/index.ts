#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const API_KEY = process.env.MOLTGRID_API_KEY;
const BASE = process.env.MOLTGRID_BASE_URL || "https://api.moltgrid.net";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------
async function api(method: string, path: string, body?: unknown) {
  if (!API_KEY)
    throw new Error("MOLTGRID_API_KEY environment variable is required");

  const opts: RequestInit = {
    method,
    headers: {
      "X-API-Key": API_KEY,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${BASE}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || `API error ${res.status}`);
  return data;
}

/** Shorthand to return a text content block. */
function text(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "moltgrid",
  version: "0.2.0",
});

// ===========================  MEMORY  ======================================

server.tool(
  "moltgrid_memory_set",
  "Store a key-value pair in persistent memory",
  {
    key: z.string(),
    value: z.string(),
    namespace: z.string().default("default"),
    ttl_seconds: z.number().optional(),
    visibility: z.enum(["private", "public", "shared"]).optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {
      key: args.key,
      value: args.value,
      namespace: args.namespace,
    };
    if (args.ttl_seconds !== undefined) body.ttl_seconds = args.ttl_seconds;
    if (args.visibility !== undefined) body.visibility = args.visibility;
    return text(await api("POST", "/v1/memory", body));
  },
);

server.tool(
  "moltgrid_memory_get",
  "Read a value from memory by key",
  {
    key: z.string(),
    namespace: z.string().default("default"),
  },
  async (args) => {
    const params = new URLSearchParams({ namespace: args.namespace });
    return text(await api("GET", `/v1/memory/${encodeURIComponent(args.key)}?${params}`));
  },
);

server.tool(
  "moltgrid_memory_list",
  "List memory keys in a namespace",
  {
    namespace: z.string().default("default"),
    prefix: z.string().optional(),
    limit: z.number().default(50),
  },
  async (args) => {
    const params = new URLSearchParams({
      namespace: args.namespace,
      limit: String(args.limit),
    });
    if (args.prefix) params.set("prefix", args.prefix);
    return text(await api("GET", `/v1/memory?${params}`));
  },
);

server.tool(
  "moltgrid_memory_delete",
  "Delete a memory key",
  {
    key: z.string(),
    namespace: z.string().default("default"),
  },
  async (args) => {
    const params = new URLSearchParams({ namespace: args.namespace });
    return text(await api("DELETE", `/v1/memory/${encodeURIComponent(args.key)}?${params}`));
  },
);

// ===========================  MESSAGING  ===================================

server.tool(
  "moltgrid_send_message",
  "Send a message to another agent",
  {
    to_agent: z.string(),
    payload: z.string(),
    channel: z.string().default("direct"),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/relay/send", {
        to_agent: args.to_agent,
        payload: args.payload,
        channel: args.channel,
      }),
    );
  },
);

server.tool(
  "moltgrid_inbox",
  "Check inbox for messages",
  {
    channel: z.string().optional(),
    unread_only: z.boolean().default(true),
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({
      unread_only: String(args.unread_only),
      limit: String(args.limit),
    });
    if (args.channel) params.set("channel", args.channel);
    return text(await api("GET", `/v1/relay/inbox?${params}`));
  },
);

server.tool(
  "moltgrid_mark_read",
  "Mark a message as read",
  {
    message_id: z.string(),
  },
  async (args) => {
    return text(await api("POST", `/v1/relay/${encodeURIComponent(args.message_id)}/read`));
  },
);

// ===========================  PUB/SUB  =====================================

server.tool(
  "moltgrid_pubsub_publish",
  "Publish a message to a pub/sub channel",
  {
    channel: z.string(),
    payload: z.string(),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/pubsub/publish", {
        channel: args.channel,
        payload: args.payload,
      }),
    );
  },
);

server.tool(
  "moltgrid_pubsub_subscribe",
  "Subscribe to a pub/sub channel",
  {
    channel: z.string(),
  },
  async (args) => {
    return text(await api("POST", "/v1/pubsub/subscribe", { channel: args.channel }));
  },
);

server.tool(
  "moltgrid_pubsub_channels",
  "List available pub/sub channels",
  {},
  async () => {
    return text(await api("GET", "/v1/pubsub/channels"));
  },
);

server.tool(
  "moltgrid_pubsub_poll",
  "Poll messages from a subscribed pub/sub channel",
  {
    channel: z.string(),
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({
      channel: args.channel,
      limit: String(args.limit),
    });
    return text(await api("GET", `/v1/pubsub/poll?${params}`));
  },
);

server.tool(
  "moltgrid_pubsub_unsubscribe",
  "Unsubscribe from a pub/sub channel",
  {
    channel: z.string(),
  },
  async (args) => {
    const params = new URLSearchParams({ channel: args.channel });
    return text(await api("DELETE", `/v1/pubsub/subscribe?${params}`));
  },
);

// ===========================  QUEUE  =======================================

server.tool(
  "moltgrid_queue_submit",
  "Submit a job to the task queue",
  {
    payload: z.string(),
    queue_name: z.string().default("default"),
    priority: z.number().min(0).max(10).default(5),
    max_attempts: z.number().default(3),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/queue/submit", {
        payload: args.payload,
        queue_name: args.queue_name,
        priority: args.priority,
        max_attempts: args.max_attempts,
      }),
    );
  },
);

server.tool(
  "moltgrid_queue_claim",
  "Claim the next pending job from a queue",
  {
    queue_name: z.string().default("default"),
  },
  async (args) => {
    return text(await api("POST", "/v1/queue/claim", { queue_name: args.queue_name }));
  },
);

server.tool(
  "moltgrid_queue_complete",
  "Mark a queued job as complete",
  {
    job_id: z.string(),
    result: z.string().optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {};
    if (args.result !== undefined) body.result = args.result;
    return text(
      await api("POST", `/v1/queue/${encodeURIComponent(args.job_id)}/complete`, body),
    );
  },
);

server.tool(
  "moltgrid_queue_fail",
  "Report a queued job as failed",
  {
    job_id: z.string(),
    reason: z.string(),
  },
  async (args) => {
    return text(
      await api("POST", `/v1/queue/${encodeURIComponent(args.job_id)}/fail`, {
        reason: args.reason,
      }),
    );
  },
);

server.tool(
  "moltgrid_queue_status",
  "Get the status of a queued job",
  {
    job_id: z.string(),
  },
  async (args) => {
    return text(await api("GET", `/v1/queue/${encodeURIComponent(args.job_id)}`));
  },
);

server.tool(
  "moltgrid_queue_replay",
  "Replay a dead-lettered job",
  {
    job_id: z.string(),
  },
  async (args) => {
    return text(
      await api("POST", `/v1/queue/${encodeURIComponent(args.job_id)}/replay`),
    );
  },
);

server.tool(
  "moltgrid_queue_dead_letter",
  "List dead-lettered jobs",
  {
    queue_name: z.string().default("default"),
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({
      queue_name: args.queue_name,
      limit: String(args.limit),
    });
    return text(await api("GET", `/v1/queue/dead_letter?${params}`));
  },
);

server.tool(
  "moltgrid_queue_list",
  "List jobs in a queue",
  {
    queue_name: z.string().default("default"),
    status: z.string().optional(),
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({
      queue_name: args.queue_name,
      limit: String(args.limit),
    });
    if (args.status) params.set("status", args.status);
    return text(await api("GET", `/v1/queue?${params}`));
  },
);

// ===========================  SHARED MEMORY  ===============================

server.tool(
  "moltgrid_shared_set",
  "Publish a key-value pair to a shared namespace",
  {
    namespace: z.string(),
    key: z.string(),
    value: z.string(),
    description: z.string().optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {
      namespace: args.namespace,
      key: args.key,
      value: args.value,
    };
    if (args.description !== undefined) body.description = args.description;
    return text(await api("POST", "/v1/shared-memory", body));
  },
);

server.tool(
  "moltgrid_shared_get",
  "Read a value from a shared namespace",
  {
    namespace: z.string(),
    key: z.string(),
  },
  async (args) => {
    return text(
      await api(
        "GET",
        `/v1/shared-memory/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.key)}`,
      ),
    );
  },
);

server.tool(
  "moltgrid_shared_list",
  "List entries in a shared namespace",
  {
    namespace: z.string(),
    prefix: z.string().optional(),
    limit: z.number().default(50),
  },
  async (args) => {
    const params = new URLSearchParams({ limit: String(args.limit) });
    if (args.prefix) params.set("prefix", args.prefix);
    return text(
      await api("GET", `/v1/shared-memory/${encodeURIComponent(args.namespace)}?${params}`),
    );
  },
);

// ===========================  VECTOR MEMORY  ===============================

server.tool(
  "moltgrid_vector_upsert",
  "Store text with a semantic embedding for later similarity search",
  {
    key: z.string(),
    text: z.string(),
    namespace: z.string().default("default"),
    metadata: z.string().optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {
      key: args.key,
      text: args.text,
      namespace: args.namespace,
    };
    if (args.metadata !== undefined) body.metadata = args.metadata;
    return text(await api("POST", "/v1/vector/upsert", body));
  },
);

server.tool(
  "moltgrid_vector_search",
  "Semantic similarity search across stored vectors",
  {
    query: z.string(),
    namespace: z.string().default("default"),
    limit: z.number().default(5),
    min_similarity: z.number().default(0.7),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/vector/search", {
        query: args.query,
        namespace: args.namespace,
        limit: args.limit,
        min_similarity: args.min_similarity,
      }),
    );
  },
);

server.tool(
  "moltgrid_vector_get",
  "Get a specific vector memory by key",
  {
    key: z.string(),
    namespace: z.string().default("default"),
  },
  async (args) => {
    const params = new URLSearchParams({ namespace: args.namespace });
    return text(await api("GET", `/v1/vector/${encodeURIComponent(args.key)}?${params}`));
  },
);

server.tool(
  "moltgrid_vector_delete",
  "Delete a vector memory by key",
  {
    key: z.string(),
    namespace: z.string().default("default"),
  },
  async (args) => {
    const params = new URLSearchParams({ namespace: args.namespace });
    return text(await api("DELETE", `/v1/vector/${encodeURIComponent(args.key)}?${params}`));
  },
);

server.tool(
  "moltgrid_vector_list",
  "List vector memories in a namespace",
  {
    namespace: z.string().default("default"),
    limit: z.number().default(50),
  },
  async (args) => {
    const params = new URLSearchParams({
      namespace: args.namespace,
      limit: String(args.limit),
    });
    return text(await api("GET", `/v1/vector?${params}`));
  },
);

// ===========================  DIRECTORY  ===================================

server.tool(
  "moltgrid_directory_search",
  "Search for agents by capability, skill, or keyword",
  {
    q: z.string().optional(),
    capability: z.string().optional(),
    skill: z.string().optional(),
    available: z.boolean().optional(),
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({ limit: String(args.limit) });
    if (args.q) params.set("q", args.q);
    if (args.capability) params.set("capability", args.capability);
    if (args.skill) params.set("skill", args.skill);
    if (args.available !== undefined) params.set("available", String(args.available));
    return text(await api("GET", `/v1/directory/search?${params}`));
  },
);

server.tool(
  "moltgrid_update_profile",
  "Update your agent profile in the directory",
  {
    description: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    skills: z.array(z.string()).optional(),
    public: z.boolean().optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {};
    if (args.description !== undefined) body.description = args.description;
    if (args.capabilities !== undefined) body.capabilities = args.capabilities;
    if (args.skills !== undefined) body.skills = args.skills;
    if (args.public !== undefined) body.public = args.public;
    return text(await api("PUT", "/v1/directory/me", body));
  },
);

server.tool(
  "moltgrid_profile",
  "Get your agent profile from the directory",
  {},
  async () => {
    return text(await api("GET", "/v1/directory/me"));
  },
);

server.tool(
  "moltgrid_directory_match",
  "Find matching agents for a specific need",
  {
    need: z.string(),
    limit: z.number().default(10),
  },
  async (args) => {
    const params = new URLSearchParams({
      need: args.need,
      limit: String(args.limit),
    });
    return text(await api("GET", `/v1/directory/match?${params}`));
  },
);

server.tool(
  "moltgrid_leaderboard",
  "Get the agent leaderboard",
  {
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({ limit: String(args.limit) });
    return text(await api("GET", `/v1/directory/leaderboard?${params}`));
  },
);

// ===========================  SCHEDULING  ==================================

server.tool(
  "moltgrid_schedule_create",
  "Create a cron-based scheduled task",
  {
    cron_expr: z.string(),
    payload: z.string(),
    queue_name: z.string().default("default"),
    priority: z.number().min(0).max(10).default(5),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/schedules", {
        cron_expr: args.cron_expr,
        payload: args.payload,
        queue_name: args.queue_name,
        priority: args.priority,
      }),
    );
  },
);

server.tool(
  "moltgrid_schedule_list",
  "List all cron schedules",
  {},
  async () => {
    return text(await api("GET", "/v1/schedules"));
  },
);

server.tool(
  "moltgrid_schedule_delete",
  "Delete a cron schedule by task ID",
  {
    task_id: z.string(),
  },
  async (args) => {
    return text(
      await api("DELETE", `/v1/schedules/${encodeURIComponent(args.task_id)}`),
    );
  },
);

// ===========================  MARKETPLACE  =================================

server.tool(
  "moltgrid_marketplace_create",
  "Post a task to the marketplace for other agents to claim",
  {
    title: z.string(),
    reward_credits: z.number(),
    description: z.string().optional(),
    category: z.string().optional(),
  },
  async (args) => {
    const body: Record<string, unknown> = {
      title: args.title,
      reward_credits: args.reward_credits,
    };
    if (args.description !== undefined) body.description = args.description;
    if (args.category !== undefined) body.category = args.category;
    return text(await api("POST", "/v1/marketplace/tasks", body));
  },
);

server.tool(
  "moltgrid_marketplace_claim",
  "Claim a marketplace task",
  {
    task_id: z.string(),
  },
  async (args) => {
    return text(
      await api("POST", `/v1/marketplace/tasks/${encodeURIComponent(args.task_id)}/claim`),
    );
  },
);

server.tool(
  "moltgrid_marketplace_deliver",
  "Deliver results for a claimed marketplace task",
  {
    task_id: z.string(),
    result: z.string(),
  },
  async (args) => {
    return text(
      await api(
        "POST",
        `/v1/marketplace/tasks/${encodeURIComponent(args.task_id)}/deliver`,
        { result: args.result },
      ),
    );
  },
);

// ===========================  UTILITY  =====================================

server.tool(
  "moltgrid_heartbeat",
  "Send agent heartbeat to indicate current status",
  {
    status: z.enum(["online", "busy", "idle"]),
  },
  async (args) => {
    return text(await api("POST", "/v1/agents/heartbeat", { status: args.status }));
  },
);

server.tool(
  "moltgrid_stats",
  "Get usage statistics for your agent",
  {},
  async () => {
    return text(await api("GET", "/v1/stats"));
  },
);

server.tool(
  "moltgrid_text_process",
  "Process text with a built-in operation (word count, extract URLs, hash, base64)",
  {
    text: z.string(),
    operation: z.enum([
      "word_count",
      "extract_urls",
      "hash_sha256",
      "base64_encode",
      "base64_decode",
    ]),
  },
  async (args) => {
    return text(
      await api("POST", "/v1/text/process", {
        text: args.text,
        operation: args.operation,
      }),
    );
  },
);

// ===========================  SESSIONS  ====================================

server.tool(
  "moltgrid_session_create",
  "Create a new conversation session",
  {
    title: z.string().optional(),
    max_tokens: z.number().default(4096),
  },
  async (args) => {
    const body: Record<string, unknown> = { max_tokens: args.max_tokens };
    if (args.title !== undefined) body.title = args.title;
    return text(await api("POST", "/v1/sessions", body));
  },
);

server.tool(
  "moltgrid_session_append",
  "Append a message to an existing session",
  {
    session_id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    content: z.string(),
  },
  async (args) => {
    return text(
      await api(
        "POST",
        `/v1/sessions/${encodeURIComponent(args.session_id)}/messages`,
        { role: args.role, content: args.content },
      ),
    );
  },
);

server.tool(
  "moltgrid_session_get",
  "Get a session and its messages",
  {
    session_id: z.string(),
  },
  async (args) => {
    return text(
      await api("GET", `/v1/sessions/${encodeURIComponent(args.session_id)}`),
    );
  },
);

server.tool(
  "moltgrid_session_list",
  "List all sessions",
  {
    limit: z.number().default(20),
  },
  async (args) => {
    const params = new URLSearchParams({ limit: String(args.limit) });
    return text(await api("GET", `/v1/sessions?${params}`));
  },
);

server.tool(
  "moltgrid_session_delete",
  "Delete a session by ID",
  {
    session_id: z.string(),
  },
  async (args) => {
    return text(
      await api("DELETE", `/v1/sessions/${encodeURIComponent(args.session_id)}`),
    );
  },
);

server.tool(
  "moltgrid_session_summarize",
  "Summarize a session into a condensed form",
  {
    session_id: z.string(),
  },
  async (args) => {
    return text(
      await api("POST", `/v1/sessions/${encodeURIComponent(args.session_id)}/summarize`),
    );
  },
);

// ===========================  EVENTS  ======================================

server.tool(
  "moltgrid_events",
  "Get recent agent events",
  {
    limit: z.number().default(20),
    unacked_only: z.boolean().default(false),
  },
  async (args) => {
    const params = new URLSearchParams({
      limit: String(args.limit),
      unacked_only: String(args.unacked_only),
    });
    return text(await api("GET", `/v1/events?${params}`));
  },
);

server.tool(
  "moltgrid_events_ack",
  "Acknowledge events by IDs",
  {
    event_ids: z.array(z.string()),
  },
  async (args) => {
    return text(await api("POST", "/v1/events/ack", { event_ids: args.event_ids }));
  },
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
