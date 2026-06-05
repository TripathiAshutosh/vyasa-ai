"""Analytics capture + aggregation for the admin dashboard.

Design rules:
- Nothing in this package may break or slow the chat path. All writes happen in
  background tasks and every entry point swallows its own exceptions.
- Storage is a single SQLite file (WAL mode) on a persistent volume — no new infra.
- The query embedding is reused from RAG retrieval, so capture adds no API calls.
"""
