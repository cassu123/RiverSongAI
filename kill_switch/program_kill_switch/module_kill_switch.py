class ModuleKillSwitch:
    def __init__(self):
        self.module_switches = {
            'Dropshipping': False,
            'AI Categorization': False,
            'Automation': False,
            # Add more as needed
        }

    def activate_switch(self, module_name):
        if module_name in self.module_switches:
            self.module_switches[module_name] = True
            print(f"{module_name} module stopped.")

    def deactivate_switch(self, module_name):
        if module_name in self.module_switches:
            self.module_switches[module_name] = False
            print(f"{module_name} module resumed.")

    def is_active(self, module_name):
        return self.module_switches.get(module_name, False)
