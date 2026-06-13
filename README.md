# Smart-City-Transport-System-DB
Oracle 11g database for managing a smart city transport system — buses, trains, routes, stations, drivers, tickets &amp; schedules. Built with PL/SQL triggers, stored procedures, views, and role-based access control (Admin/Manager/Passenger).

🚌 Smart City Transport System – Database Project
Oracle 11g PL/SQL Oracle APEX University Project Database Systems
A relational database solution for managing public transportation in a smart city — covering buses, trains, routes, stations, drivers, passengers, tickets, and schedules with role-based access control.

📋 Overview
This project implements a fully normalized database (up to 3NF) with PL/SQL business logic, triggers, stored procedures, and views. All data operations are role-protected (Admin / Manager / Passenger) enforced at the procedure level.

🗄️ Database Schema
Users — Authentication and role management (Admin, Manager, Passenger)
Passenger — Passenger profiles linked to Users
Driver — Driver records with license and status
Station — Bus/Train/Both station types with city info
Route — Routes with start/end stations, distance, duration
Route_Station — Junction table for many-to-many route ↔ station
Vehicle — Buses and trains with capacity and status
Schedule — Trips linking route, vehicle, and driver
Ticket — Passenger bookings with fare and payment status

⚙️ Key Features
Role-based access via fn_user_has_role() helper function
Triggers: auto-initialize seat count on schedule insert; restore seats on ticket cancel
7 stored procedures for full CRUD with privilege enforcement
2 views: vw_TicketDetails and vw_UpcomingSchedules
Subqueries and multi-table JOINs for reporting

🛠️ Tech Stack
Database: Oracle 11g
Language: SQL / PL/SQL
UI: Oracle APEX

👥 Authors
Muhammad Humd & Muhammad Hammad Abid — National University of Computer and Emerging Sciences(NUCES), Database Systems, 2024–25
