from typing import Any

import config


class VectorService:
    def __init__(self) -> None:
        self.collections: dict[str, Any] = {}
        self.available = False
        if not config.ENABLE_VECTOR_SEARCH:
            return
        try:
            import chromadb

            client = chromadb.PersistentClient(path=config.VECTOR_STORE_PATH)
            self.collections['interactions'] = client.get_or_create_collection('interactions')
            self.collections['knowledge_memories'] = client.get_or_create_collection('knowledge_memories')
            self.available = True
        except Exception:
            self.collections = {}
            self.available = False

    # ---- Interaction methods (existing) ----

    def add_interaction(self, interaction_id: str, text: str, metadata: dict[str, Any]) -> None:
        if not self.available or 'interactions' not in self.collections:
            return
        safe_metadata = {
            key: value if isinstance(value, (str, int, float, bool)) or value is None else str(value)
            for key, value in metadata.items()
        }
        try:
            self.collections['interactions'].upsert(ids=[interaction_id], documents=[text], metadatas=[safe_metadata])
        except Exception:
            self.available = False

    def find_similar_interactions(self, user_id: str, query: str, top_k: int = 3) -> list[dict[str, Any]]:
        if not self.available or 'interactions' not in self.collections:
            return []
        try:
            results = self.collections['interactions'].query(
                query_texts=[query],
                where={'user_id': user_id},
                n_results=top_k,
            )
        except Exception:
            self.available = False
            return []
        documents = results.get('documents', [[]])[0]
        metadatas = results.get('metadatas', [[]])[0]
        ids = results.get('ids', [[]])[0]
        return [
            {'id': ids[index], 'text': documents[index], 'metadata': metadatas[index]}
            for index in range(len(documents))
        ]

    # ---- Knowledge memory methods ----

    def add_knowledge_memory(self, memory_id: str, text: str, metadata: dict[str, Any]) -> None:
        """Add or update a knowledge memory embedding."""
        if not self.available or 'knowledge_memories' not in self.collections:
            return
        safe_metadata = {
            key: value if isinstance(value, (str, int, float, bool)) or value is None else str(value)
            for key, value in metadata.items()
        }
        try:
            self.collections['knowledge_memories'].upsert(
                ids=[memory_id],
                documents=[text],
                metadatas=[safe_metadata],
            )
        except Exception:
            pass  # best-effort: vector embedding is non-critical

    def search_knowledge_memories(
        self, user_id: str, query: str, top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Semantic search across knowledge_memories."""
        if not self.available or 'knowledge_memories' not in self.collections:
            return []
        try:
            results = self.collections['knowledge_memories'].query(
                query_texts=[query],
                where={'user_id': user_id},
                n_results=top_k,
            )
        except Exception:
            return []
        documents = results.get('documents', [[]])[0]
        metadatas = results.get('metadatas', [[]])[0]
        ids = results.get('ids', [[]])[0]
        distances = results.get('distances', [[]])[0]
        return [
            {
                'id': ids[index],
                'text': documents[index],
                'metadata': metadatas[index],
                'distance': distances[index] if index < len(distances) else None,
            }
            for index in range(len(documents))
        ]

    def delete_knowledge_memory(self, memory_id: str) -> None:
        """Remove a knowledge memory from ChromaDB."""
        if not self.available or 'knowledge_memories' not in self.collections:
            return
        try:
            self.collections['knowledge_memories'].delete(ids=[memory_id])
        except Exception:
            pass


vector_service = VectorService()
