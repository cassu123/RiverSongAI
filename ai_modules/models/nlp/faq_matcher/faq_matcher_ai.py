class FAQMatcherAI:
    def __init__(self, faq_data):
        self.faq_data = faq_data

    def match_faq(self, user_question):
        # Basic matching logic: search for question in FAQs
        matched_faq = [faq for faq in self.faq_data if user_question.lower() in faq['question'].lower()]
        return matched_faq if matched_faq else "No matching FAQ found."
