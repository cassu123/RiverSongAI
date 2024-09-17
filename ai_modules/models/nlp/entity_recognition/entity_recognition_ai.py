import spacy

class EntityRecognitionAI:
    def __init__(self):
        # Load a pre-trained entity recognition model (e.g., from spaCy)
        self.nlp = spacy.load("en_core_web_sm")

    def recognize_entities(self, text):
        doc = self.nlp(text)
        entities = [(ent.text, ent.label_) for ent in doc.ents]
        return entities if entities else "No entities recognized."
