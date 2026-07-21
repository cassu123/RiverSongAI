import re

with open("frontend/src/components/MaintenancePulse.jsx", "r") as f:
    content = f.read()

# Add isNonRoad to PredictiveTimeline props
content = re.sub(
    r'function PredictiveTimeline\(\{ token, vehicleId, currentOdometer \}\) \{',
    'function PredictiveTimeline({ token, vehicleId, currentOdometer, isNonRoad }) {',
    content
)

# Update PredictiveTimeline usages of 'mi' and 'miles'
content = content.replace(
    'NOW (Overdue by {Math.abs(item.miles_remaining)} mi)',
    'NOW (Overdue by {Math.abs(item.miles_remaining)} {isNonRoad ? "hrs" : "mi"})'
)
content = content.replace(
    ': `in ${item.miles_remaining} miles`}',
    ': `in ${item.miles_remaining} ${isNonRoad ? "hours" : "miles"}`}'
)
content = content.replace(
    'in {item.miles_remaining} mi</span>',
    'in {item.miles_remaining} {isNonRoad ? "hrs" : "mi"}</span>'
)

# Pass isNonRoad when rendering PredictiveTimeline
content = re.sub(
    r'<PredictiveTimeline token=\{token\} vehicleId=\{currentVehicle.id\} currentOdometer=\{mileage\} />',
    '<PredictiveTimeline token={token} vehicleId={currentVehicle.id} currentOdometer={mileage} isNonRoad={isNonRoad} />',
    content
)

# Also fix the form labels that say (MILES) for CheckPointForm and the new interval row
content = content.replace('INTERVAL (MILES)', 'INTERVAL ({isNonRoad ? "HOURS" : "MILES"})')
content = content.replace('NEXT DUE (MILES)', 'NEXT DUE ({isNonRoad ? "HOURS" : "MILES"})')

with open("frontend/src/components/MaintenancePulse.jsx", "w") as f:
    f.write(content)
