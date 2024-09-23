from kill_switch.program_kill_switch.module_kill_switch import ModuleKillSwitch

module_kill_switch = ModuleKillSwitch()

def perform_keyword_research():
    if module_kill_switch.is_active('ProductResearch'):
        print("Product Research module is disabled. Shutting down operation.")
        return
    print("Performing keyword research...")
    # Your keyword research logic here


class KeywordResearch:
    def __init__(self, api_key):
        self.api_key = api_key

    def search_keywords(self, product):
        """Research keywords for a given product."""
        print(f"Researching keywords for product: {product}")
        return "Keyword research completed."
