import os.path
import datetime
import pandas as pd
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google_auth_oauthlib.flow import InstalledAppFlow
import schedule
import time

# If modifying these scopes, delete the file token.json.
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

# The ID of your Google Sheet.
SPREADSHEET_ID = 'your_google_sheet_id_here'  # Replace with your actual Google Sheet ID

# Function to authenticate and build the service
def build_service():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    # If credentials are invalid or don't exist, go through the OAuth flow.
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                'credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        # Save the credentials for next time.
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    # Build the service
    service = build('sheets', 'v4', credentials=creds)
    return service

# Function to update the Google Sheet
def update_sheet(data, range_name):
    service = build_service()
    # Prepare the data in the format required by the Sheets API
    values = data  # This should be a list of lists
    body = {'values': values}
    # Call the Sheets API to update the data
    result = service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=range_name,
        valueInputOption='RAW',
        body=body
    ).execute()
    print(f"{result.get('updatedCells')} cells updated in range {range_name}.")

# Function to fetch data from your system and prepare it for the sheet
def prepare_order_data():
    # Replace this with actual data retrieval logic
    # For example, data could be fetched from a database or another API
    # Here, we'll create a dummy data set
    data = [
        ['Order ID', 'Product', 'Quantity', 'Category', 'Order Date'],
        [12345, 'Yoga Mat', 10, 'Workout', '2023-10-15'],
        [12346, 'Massage Oil', 5, 'Wellness', '2023-10-16'],
    ]
    return data

# Main function to coordinate the update
def main_update():
    # Prepare data
    data = prepare_order_data()
    # Define the range in the sheet where data will be updated
    range_name = 'Orders!A1'  # Replace 'Orders' with your sheet name
    # Update the sheet
    update_sheet(data, range_name)

# Schedule the update when an order is approved
def order_approved_callback(order_details):
    # Extract necessary information from order_details
    # Prepare data to update
    data = [
        [order_details['order_id'], order_details['product'], order_details['quantity'],
         order_details['category'], order_details['order_date']]
    ]
    # Update the sheet at the next empty row
    range_name = find_next_empty_row('Orders')
    update_sheet(data, range_name)

# Function to find the next empty row in a sheet
def find_next_empty_row(sheet_name):
    service = build_service()
    sheet = service.spreadsheets()
    result = sheet.values().get(spreadsheetId=SPREADSHEET_ID,
                                range=f'{sheet_name}!A:A').execute()
    values = result.get('values', [])
    next_row = len(values) + 1  # Assuming no gaps in data
    range_name = f'{sheet_name}!A{next_row}'
    return range_name

if __name__ == '__main__':
    # For testing purposes, we'll call main_update directly
    main_update()

    # If you want to run this script continuously and schedule tasks:
    # schedule.every().day.at("10:00").do(main_update)
    # while True:
    #     schedule.run_pending()
    #     time.sleep(1)
