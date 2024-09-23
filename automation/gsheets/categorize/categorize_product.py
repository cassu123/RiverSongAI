from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
import pandas as pd

# Load product data with labels (pre-existing categorized data)
df = pd.read_excel(inventory_file, sheet_name='Categorized Inventory')

# Text (Product Description) and Labels (Categories)
X = df['Product Description']
y = df['Category']

# Split data into training and test sets
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

# Convert text data into numerical vectors using TF-IDF
tfidf = TfidfVectorizer()
X_train_tfidf = tfidf.fit_transform(X_train)
X_test_tfidf = tfidf.transform(X_test)

# Train a classifier (Logistic Regression)
clf = LogisticRegression()
clf.fit(X_train_tfidf, y_train)

# Predict categories for the test data
predictions = clf.predict(X_test_tfidf)

# Evaluate the model (e.g., accuracy, precision)
accuracy = clf.score(X_test_tfidf, y_test)
print(f"Model accuracy: {accuracy}")

# Use the trained model to categorize new products
def categorize_with_model(product_description):
    description_tfidf = tfidf.transform([product_description])
    return clf.predict(description_tfidf)[0]

# Categorize uncategorized products
df_uncategorized = pd.read_excel(inventory_file, sheet_name='BLANK - Product Inventory')
df_uncategorized['Category'] = df_uncategorized['Product Description'].apply(categorize_with_model)

# Save the updated file
df_uncategorized.to_excel(inventory_file, sheet_name='BLANK - Product Inventory', index=False)
print("Products categorized using machine learning.")
