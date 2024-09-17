class KnowledgeBaseAI:
    def __init__(self, knowledge_data):
        self.knowledge_data = knowledge_data

    def search_knowledge_base(self, query):
        # Implement search logic for retrieving relevant knowledge
        results = [entry for entry in self.knowledge_data if query.lower() in entry.lower()]
        return results or "No relevant information found."
