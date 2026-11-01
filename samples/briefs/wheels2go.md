Hackathon Challenge Brief: "Wheels2Go" (P2P Mobility Marketplace — Car Only)
Focusing exclusively on Cars streamlines the application scope, data structures, and UI layout while keeping token usage low and generation fast during live AI Factory runs.

1. Challenge Overview & Objective
Challenge Title: Wheels2Go — Peer-to-Peer Car Rental & Sharing Platform

Objective: Teams will configure their Agentic AI Factory to ingest this prompt and autonomously generate structured requirements, UI design tokens, full-stack code, and automated QA validations.

Core Business Model: A two-sided marketplace where Car Owners list their vehicles for rent, and Renters discover, book, and manage car rentals with clear pickup/drop-off locations and transparent pricing.

2. Official Input Prompt for Teams
(Organizers will deliver this exact text block to teams to pass into their Requirement Writing Agent).

Input Prompt for the AI Factory:
*"Build a fully functional, responsive web application called Wheels2Go, a two-sided P2P car rental platform. The application must support two primary user roles: Car Owner and Renter.

Key Capabilities:

Car Listing Creation & Location Management (Owner Side):

Owners can list cars with details including Make, Model, Year, Fuel/EV Type, Transmission, Daily Rental Rate, and Image URL.

Every listing must specify a Pickup/Drop-off Location (e.g., City, Airport Hub, or Specific Address).

Discovery & Filtering (Renter Side):

Renters can browse available cars in a grid/list view with search and filtering options (by Make/Brand, Location Keyword, Maximum Daily Rate, and Transmission).

Booking & Reservation Flow (Renter & Owner):

Renters can select start and end dates for a car, automatically calculating the total price (${\text{Days}} \times {\text{Daily Rate}} + \text{Cleaning Fee}$).

Owners can view incoming booking requests on their dashboard and update their status (Pending, Confirmed, or Cancelled)."*

3. Core Feature Specifications by Role
A. Car Owner Portal
Listing Management: Add, edit, or toggle availability status for car listings.

Location Setup: Set pickup instructions, drop-off rules, and address guidelines.

Booking Requests Queue: View incoming rental requests from renters and approve or decline them.

Earnings Tracker: Simple dashboard overview showing completed rentals and total revenue earned.

B. Renter Portal
Marketplace Catalog: Clean grid view displaying car cards with high-resolution image URLs, daily rates, fuel types, and location badges.

Search & Filters: Filter inventory by make/model, maximum daily price, transmission (Automatic vs. Manual), and location keyword.

Checkout & Calculation: Dynamic price breakdown displaying days count, daily rate, cleaning fee, and calculated total amount.

My Bookings Dashboard: View upcoming, active, and completed rentals with status tags (Pending, Confirmed, Completed).

4. Testable Requirements Matrix for Judges
To verify that each team's AI Factory has produced a working application, judges will run these 4 core test cases:



Module
Requirement
Test Action
Pass Criteria
TR-1: Car Listing Creation
Owners can list a new vehicle with all required specs and pickup location.
Create a listing: "Tesla Model Y 2023", $85/day, Location: "Airport Hub".
Listing appears instantly in the catalog feed with correct details and location badge.
TR-2: Search & Filter Validation
Renters can filter inventory by make and maximum daily rate.
Filter catalog by Make = "Tesla" or set Max Daily Rate = $90.
Non-matching cars disappear from the active feed in real time.
TR-3: Dynamic Pricing Math
Checkout flow calculates total cost accurately based on duration and fees.
Select a 3-day rental for an $85/day car with a $25 cleaning fee.
Checkout summary displays exactly $280.00 ($255 rental + $25 fee).
TR-4: Owner Booking Approval
Owners can manage rental request states from their portal.
Log into Owner view, locate a pending booking request, and click "Approve".
Booking status updates to Confirmed across both owner and renter portals.
5. Pre-Populated Seed Dataset (JSON)
Teams can seed this JSON dataset directly into local storage or database tables to test searching, booking, and dashboard states immediately.
JSON
{
  "users": [
    {
      "id": "usr_101",
      "name": "Sarah Jenkins",
      "email": "sarah.j@example.com",
      "role": "owner",
      "avatar_url": "https://images.unsplash.com/photo-1494790108377-be9c29b29330"
    },
    {
      "id": "usr_102",
      "name": "Alex Rivera",
      "email": "alex.rivera@example.com",
      "role": "renter",
      "avatar_url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d"
    }
  ],
  "cars": [
    {
      "id": "car_01",
      "owner_id": "usr_101",
      "title": "Tesla Model Y Long Range 2023",
      "brand": "Tesla",
      "model": "Model Y",
      "year": 2023,
      "daily_rate": 85,
      "cleaning_fee": 25,
      "location": {
        "city": "Miami",
        "state": "FL",
        "pickup_address": "Miami International Airport Hub - Zone B"
      },
      "specs": {
        "seats": 5,
        "fuel_type": "Electric",
        "transmission": "Automatic"
      },
      "image_url": "https://images.unsplash.com/photo-1560958089-b8a1929cea89",
      "status": "available"
    },
    {
      "id": "car_02",
      "owner_id": "usr_101",
      "title": "Ford Bronco Wildtrak 4x4",
      "brand": "Ford",
      "model": "Bronco",
      "year": 2022,
      "daily_rate": 110,
      "cleaning_fee": 35,
      "location": {
        "city": "Denver",
        "state": "CO",
        "pickup_address": "Downtown Denver Garage - 14th St"
      },
      "specs": {
        "seats": 5,
        "fuel_type": "Gasoline",
        "transmission": "Automatic"
      },
      "image_url": "https://images.unsplash.com/photo-1533473359331-0135ef1b58bf",
      "status": "available"
    },
    {
      "id": "car_03",
      "owner_id": "usr_101",
      "title": "BMW M3 Competition 2021",
      "brand": "BMW",
      "model": "M3",
      "year": 2021,
      "daily_rate": 140,
      "cleaning_fee": 40,
      "location": {
        "city": "Los Angeles",
        "state": "CA",
        "pickup_address": "LAX Express Pickup Lot"
      },
      "specs": {
        "seats": 5,
        "fuel_type": "Gasoline",
        "transmission": "Automatic"
      },
      "image_url": "https://images.unsplash.com/photo-1555215695-3004980adade",
      "status": "available"
    }
  ],
  "bookings": [
    {
      "id": "book_301",
      "renter_id": "usr_102",
      "car_id": "car_01",
      "start_date": "2026-11-10",
      "end_date": "2026-11-13",
      "days": 3,
      "daily_rate": 85,
      "cleaning_fee": 25,
      "total_price": 280,
      "pickup_location": "Miami International Airport Hub - Zone B",
      "status": "confirmed",
      "created_at": "2026-10-28T14:32:00Z"
    }
  ]
}