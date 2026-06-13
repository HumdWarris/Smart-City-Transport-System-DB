const express = require('express');
const oracledb = require('oracledb');
const bodyParser = require('body-parser');
const app = express();

try {
    oracledb.initOracleClient();
} catch (err) {
    console.error("Thick mode initialization failed. Ensure Oracle Instant Client is installed.");
}

app.use(bodyParser.json());
app.use(express.static(__dirname));

const dbConfig = {
    user: "SCT",
    password: "humd8305",
    connectString: "localhost:1521/xe"
};

// ─────────────────────────────────────────────
//  AUTH: LOGIN
//  Looks up user by email + role, returns ID, name, role
// ─────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    let conn;
    try {
        const { email, password, role } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ success: false, message: 'Email, password, and role are required.' });
        }

        conn = await oracledb.getConnection(dbConfig);

        // Fetch user by email + role (password check: compare hash or plain depending on your setup)
        const result = await conn.execute(
            `SELECT USER_ID, FULL_NAME, EMAIL, ROLE, STATUS
             FROM USERS
             WHERE EMAIL = :email AND ROLE = :role AND STATUS = 'Active'`,
            { email: email.trim().toLowerCase(), role },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid email, role, or account is inactive.' });
        }

        const user = result.rows[0];
        res.json({
            success: true,
            userId: user.USER_ID,
            fullName: user.FULL_NAME,
            email: user.EMAIL,
            role: user.ROLE
        });
    } catch (err) {
        console.error("LOGIN ERROR:", err);
        res.status(500).json({ success: false, message: 'Server error: ' + err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  PASSENGER: FULL PROFILE
//  Returns user info + booking stats + active tickets + full history
// ─────────────────────────────────────────────
app.get('/api/passenger-profile', async (req, res) => {
    let conn;
    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ success: false, message: 'userId required.' });

        conn = await oracledb.getConnection(dbConfig);

        // 1. User details from USERS table
        const userResult = await conn.execute(
            `SELECT USER_ID, FULL_NAME, EMAIL, PHONE, ROLE, STATUS,
                    TO_CHAR(CREATED_AT, 'DD-Mon-YYYY') AS MEMBER_SINCE
             FROM USERS WHERE USER_ID = :uid`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        const userInfo = userResult.rows[0];

        // 2. Booking statistics
        const statsResult = await conn.execute(
            `SELECT
                COUNT(*)                                              AS TOTAL_BOOKINGS,
                COUNT(CASE WHEN B.BOOKING_STATUS = 'Confirmed'  THEN 1 END) AS ACTIVE_BOOKINGS,
                COUNT(CASE WHEN B.BOOKING_STATUS = 'Completed'  THEN 1 END) AS COMPLETED_TRIPS,
                COUNT(CASE WHEN B.BOOKING_STATUS = 'Cancelled'  THEN 1 END) AS CANCELLED_BOOKINGS,
                NVL(SUM(CASE WHEN P.PAYMENT_STATUS = 'Paid' THEN P.AMOUNT END), 0) AS TOTAL_SPENT,
                NVL(SUM(B.SEATS_BOOKED), 0)                         AS TOTAL_SEATS_BOOKED
             FROM BOOKINGS B
             LEFT JOIN PAYMENTS P ON B.BOOKING_ID = P.BOOKING_ID
             WHERE B.USER_ID = :uid`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        const stats = statsResult.rows[0];

        // 3. Active / upcoming tickets (Pending or Confirmed, trip not yet completed)
        const activeResult = await conn.execute(
            `SELECT
                B.BOOKING_ID,
                R.ROUTE_NAME,
                R.START_POINT,
                R.END_POINT,
                V.REG_NUMBER        AS VEHICLE_NO,
                V.VEHICLE_TYPE,
                TO_CHAR(T.DEPARTURE_TIME, 'DD-Mon-YYYY HH24:MI') AS DEPARTURE_TIME,
                B.SEATS_BOOKED,
                B.PICKUP_STOP,
                B.DROPOFF_STOP,
                B.BOOKING_STATUS,
                P.AMOUNT,
                P.PAYMENT_METHOD,
                P.PAYMENT_STATUS,
                DU.FULL_NAME        AS DRIVER_NAME,
                D.RATING            AS DRIVER_RATING,
                T.TRIP_STATUS
             FROM BOOKINGS B
             JOIN TRIPS    T  ON B.TRIP_ID    = T.TRIP_ID
             JOIN ROUTES   R  ON T.ROUTE_ID   = R.ROUTE_ID
             JOIN VEHICLES V  ON T.VEHICLE_ID = V.VEHICLE_ID
             JOIN DRIVERS  D  ON T.DRIVER_ID  = D.DRIVER_ID
             JOIN USERS    DU ON D.USER_ID    = DU.USER_ID
             LEFT JOIN PAYMENTS P ON B.BOOKING_ID = P.BOOKING_ID
             WHERE B.USER_ID = :uid
               AND B.BOOKING_STATUS IN ('Pending','Confirmed')
               AND T.TRIP_STATUS IN ('Scheduled','In-Progress')
             ORDER BY T.DEPARTURE_TIME ASC`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // 4. Full booking history (all statuses, all time)
        const historyResult = await conn.execute(
            `SELECT
                B.BOOKING_ID,
                R.ROUTE_NAME,
                R.START_POINT,
                R.END_POINT,
                TO_CHAR(T.DEPARTURE_TIME, 'DD-Mon-YYYY HH24:MI') AS DEPARTURE_TIME,
                B.SEATS_BOOKED,
                B.PICKUP_STOP,
                B.DROPOFF_STOP,
                B.BOOKING_STATUS,
                TO_CHAR(B.BOOKING_TIME, 'DD-Mon-YYYY HH24:MI')  AS BOOKING_TIME,
                P.AMOUNT,
                P.PAYMENT_METHOD,
                P.PAYMENT_STATUS,
                V.VEHICLE_TYPE,
                T.TRIP_STATUS
             FROM BOOKINGS B
             JOIN TRIPS    T  ON B.TRIP_ID    = T.TRIP_ID
             JOIN ROUTES   R  ON T.ROUTE_ID   = R.ROUTE_ID
             JOIN VEHICLES V  ON T.VEHICLE_ID = V.VEHICLE_ID
             LEFT JOIN PAYMENTS P ON B.BOOKING_ID = P.BOOKING_ID
             WHERE B.USER_ID = :uid
             ORDER BY B.BOOKING_ID DESC`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        // 5. Feedback submitted by this user
        const feedbackResult = await conn.execute(
            `SELECT
                F.FEEDBACK_ID,
                R.ROUTE_NAME,
                F.RATING,
                F.COMMENTS,
                TO_CHAR(F.CREATED_AT, 'DD-Mon-YYYY') AS FEEDBACK_DATE
             FROM FEEDBACK F
             JOIN TRIPS  T ON F.TRIP_ID  = T.TRIP_ID
             JOIN ROUTES R ON T.ROUTE_ID = R.ROUTE_ID
             WHERE F.USER_ID = :uid
             ORDER BY F.CREATED_AT DESC`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json({
            success: true,
            userInfo,
            stats,
            activeTickets: activeResult.rows,
            bookingHistory: historyResult.rows,
            feedback: feedbackResult.rows
        });

    } catch (err) {
        console.error("PROFILE ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  PASSENGER: GET AVAILABLE TRIPS
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
app.get('/api/trips', async (req, res) => {
    let conn;
    try {
        conn = await oracledb.getConnection(dbConfig);

        const result = await conn.execute(
            `SELECT 
                T.TRIP_ID,
                R.ROUTE_NAME,
                V.REG_NUMBER        AS VEHICLE_NO,
                V.VEHICLE_TYPE,
                T.SEATS_AVAILABLE,
                R.BASE_FARE,
                TO_CHAR(T.DEPARTURE_TIME, 'DD-Mon-YYYY HH24:MI') AS DEPARTURE_TIME
             FROM TRIPS T
             JOIN VEHICLES V ON T.VEHICLE_ID = V.VEHICLE_ID
             JOIN ROUTES R ON T.ROUTE_ID = R.ROUTE_ID
             WHERE T.TRIP_STATUS = 'Scheduled'
               AND T.SEATS_AVAILABLE > 0
             ORDER BY T.DEPARTURE_TIME ASC`,
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json({ 
            success: true, 
            data: result.rows 
        });

    } catch (err) {
        console.error("TRIPS ERROR:", {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ 
            success: false, 
            message: err.message 
        });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  PASSENGER: BOOK A TRIP
// ─────────────────────────────────────────────
app.post('/api/book', async (req, res) => {
    let conn;
    try {
        const { userId, tripId, seats, pickup, dropoff } = req.body;

        if (!userId || !tripId || !seats || !pickup || !dropoff) {
            return res.status(400).json({ success: false, message: 'All booking fields are required.' });
        }
        if (seats < 1 || seats > 10) {
            return res.status(400).json({ success: false, message: 'Seats must be between 1 and 10.' });
        }

        conn = await oracledb.getConnection(dbConfig);
        const result = await conn.execute(
            `BEGIN sp_BookTrip(:u, :t, :s, :p, :d, :bid); END;`,
            {
                u: Number(userId),
                t: Number(tripId),
                s: Number(seats),
                p: pickup,
                d: dropoff,
                bid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            },
            { autoCommit: true }
        );

        res.json({ success: true, message: 'Booking Successful! Booking ID: ' + result.outBinds.bid });
    } catch (err) {
        console.error("BOOKING ERROR:", err);
        // Surface Oracle application errors cleanly
        const msg = err.message || 'Unknown error';
        res.status(500).json({ success: false, message: msg });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  PASSENGER: MY BOOKINGS
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  PASSENGER: MY BOOKINGS (FIXED)
// ─────────────────────────────────────────────
app.get('/api/my-bookings', async (req, res) => {
    let conn;
    try {
        const userId = req.query.userId;
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'userId is required.' 
            });
        }

        conn = await oracledb.getConnection(dbConfig);

        const result = await conn.execute(
            `SELECT 
                B.BOOKING_ID,
                R.ROUTE_NAME,
                TO_CHAR(T.DEPARTURE_TIME, 'DD-Mon-YYYY HH24:MI') AS DEPARTURE_TIME,
                B.SEATS_BOOKED,
                B.BOOKING_STATUS,
                P.AMOUNT,
                P.PAYMENT_METHOD,
                P.PAYMENT_STATUS
             FROM BOOKINGS B
             JOIN TRIPS T ON B.TRIP_ID = T.TRIP_ID
             JOIN ROUTES R ON T.ROUTE_ID = R.ROUTE_ID
             LEFT JOIN PAYMENTS P ON B.BOOKING_ID = P.BOOKING_ID
             WHERE B.USER_ID = :uid
             ORDER BY B.BOOKING_ID DESC`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json({ 
            success: true, 
            data: result.rows 
        });

    } catch (err) {
        console.error("MY BOOKINGS ERROR:", {
    message: err.message,
    stack: err.stack,
    userId: req.query.userId
});
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  PASSENGER: CANCEL BOOKING
// ─────────────────────────────────────────────
app.post('/api/cancel-booking', async (req, res) => {
    let conn;
    try {
        const { bookingId, userId } = req.body;
        if (!bookingId || !userId) return res.status(400).json({ success: false, message: 'bookingId and userId required.' });

        conn = await oracledb.getConnection(dbConfig);
        await conn.execute(
            `BEGIN sp_CancelBooking(:bid, :uid); END;`,
            { bid: Number(bookingId), uid: Number(userId) },
            { autoCommit: true }
        );
        res.json({ success: true, message: 'Booking cancelled successfully.' });
    } catch (err) {
        console.error("CANCEL ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  DRIVER: GET MY TRIPS
// ─────────────────────────────────────────────
app.get('/api/driver-trips', async (req, res) => {
    let conn;
    try {
        const userId = req.query.userId;
        if (!userId) return res.status(400).json({ success: false, message: 'userId required.' });

        conn = await oracledb.getConnection(dbConfig);
        const result = await conn.execute(
            `SELECT T.TRIP_ID, R.ROUTE_NAME, V.REG_NUMBER, V.VEHICLE_TYPE,
                    TO_CHAR(T.DEPARTURE_TIME,'DD-Mon-YYYY HH24:MI') AS DEPARTURE_TIME,
                    T.TRIP_STATUS, T.SEATS_AVAILABLE
             FROM TRIPS T
             JOIN DRIVERS D ON T.DRIVER_ID = D.DRIVER_ID
             JOIN ROUTES R ON T.ROUTE_ID = R.ROUTE_ID
             JOIN VEHICLES V ON T.VEHICLE_ID = V.VEHICLE_ID
             WHERE D.USER_ID = :uid
             ORDER BY T.DEPARTURE_TIME DESC`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("DRIVER TRIPS ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  DRIVER: UPDATE TRIP STATUS
// ─────────────────────────────────────────────
app.post('/api/update-trip-status', async (req, res) => {
    let conn;
    try {
        const { tripId, newStatus, userId } = req.body;
        if (!tripId || !newStatus || !userId) return res.status(400).json({ success: false, message: 'tripId, newStatus, userId required.' });

        conn = await oracledb.getConnection(dbConfig);

        // Get driverId from userId
        const driverRes = await conn.execute(
            `SELECT DRIVER_ID FROM DRIVERS WHERE USER_ID = :uid`,
            { uid: Number(userId) },
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        if (driverRes.rows.length === 0) return res.status(403).json({ success: false, message: 'Not a driver account.' });

        const driverId = driverRes.rows[0].DRIVER_ID;
        await conn.execute(
            `BEGIN sp_UpdateTripStatus(:tid, :status, :did); END;`,
            { tid: Number(tripId), status: newStatus, did: driverId },
            { autoCommit: true }
        );
        res.json({ success: true, message: `Trip ${tripId} updated to ${newStatus}.` });
    } catch (err) {
        console.error("UPDATE TRIP ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  ADMIN: ROUTE SUMMARY REPORT
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  ADMIN: ROUTE SUMMARY REPORT (FIXED)
// ─────────────────────────────────────────────
app.get('/api/reports', async (req, res) => {
    let conn;
    try {
        conn = await oracledb.getConnection(dbConfig);

        const result = await conn.execute(
            `SELECT 
                R.ROUTE_NAME,
                R.DISTANCE_KM,
                R.BASE_FARE,
                COUNT(T.TRIP_ID)                    AS TOTAL_TRIPS,
                COUNT(B.BOOKING_ID)                 AS TOTAL_BOOKINGS,
                NVL(SUM(P.AMOUNT), 0)               AS TOTAL_REVENUE
             FROM ROUTES R
             LEFT JOIN TRIPS T ON R.ROUTE_ID = T.ROUTE_ID
             LEFT JOIN BOOKINGS B ON T.TRIP_ID = B.TRIP_ID
             LEFT JOIN PAYMENTS P ON B.BOOKING_ID = P.BOOKING_ID 
                                 AND P.PAYMENT_STATUS = 'Paid'
             GROUP BY R.ROUTE_NAME, R.DISTANCE_KM, R.BASE_FARE
             ORDER BY TOTAL_REVENUE DESC`,
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );

        res.json({ 
            success: true, 
            data: result.rows 
        });

    } catch (err) {
        console.error("REPORTS ERROR:", {
            message: err.message,
            stack: err.stack
        });
        res.status(500).json({ 
            success: false, 
            message: err.message 
        });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  ADMIN: ALL VEHICLES
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  ADMIN: ALL VEHICLES (FIXED)
// ─────────────────────────────────────────────
app.get('/api/vehicles', async (req, res) => {
    let conn;
    try {
        conn = await oracledb.getConnection(dbConfig);
        const result = await conn.execute(
            `SELECT 
                V.VEHICLE_ID,
                V.REG_NUMBER,
                V.VEHICLE_TYPE,
                V.CAPACITY,
                V.STATUS,
                V.FUEL_TYPE,
                D.FULL_NAME AS ASSIGNED_DRIVER
             FROM VEHICLES V
             LEFT JOIN DRIVERS DR ON V.VEHICLE_ID = DR.VEHICLE_ID
             LEFT JOIN USERS D ON DR.USER_ID = D.USER_ID
             ORDER BY V.REG_NUMBER`,
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("VEHICLES ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  ADMIN: ADD VEHICLE
// ─────────────────────────────────────────────
app.post('/api/add-vehicle', async (req, res) => {
    let conn;
    try {
        const { regNumber, vehicleType, capacity, fuelType, driverId } = req.body;
        if (!regNumber || !vehicleType || !capacity || !fuelType) {
            return res.status(400).json({ success: false, message: 'All vehicle fields are required.' });
        }

        conn = await oracledb.getConnection(dbConfig);
        const result = await conn.execute(
            `BEGIN sp_AddVehicle(:reg, :type, :cap, :fuel, :did, :vid); END;`,
            {
                reg: regNumber,
                type: vehicleType,
                cap: Number(capacity),
                fuel: fuelType,
                did: driverId ? Number(driverId) : null,
                vid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            },
            { autoCommit: true }
        );
        res.json({ success: true, message: 'Vehicle added. ID: ' + result.outBinds.vid });
    } catch (err) {
        console.error("ADD VEHICLE ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

// ─────────────────────────────────────────────
//  ADMIN: ALL USERS
// ─────────────────────────────────────────────
app.get('/api/users', async (req, res) => {
    let conn;
    try {
        conn = await oracledb.getConnection(dbConfig);
        const result = await conn.execute(
            `SELECT USER_ID, FULL_NAME, EMAIL, PHONE, ROLE, STATUS,
                    TO_CHAR(CREATED_AT,'DD-Mon-YYYY') AS CREATED_AT
             FROM USERS ORDER BY CREATED_AT DESC`,
            {},
            { outFormat: oracledb.OUT_FORMAT_OBJECT }
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error("USERS ERROR:", err);
        res.status(500).json({ success: false, message: err.message });
    } finally {
        if (conn) await conn.close();
    }
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));