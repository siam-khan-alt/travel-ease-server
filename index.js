const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://travel-ease-drab.vercel.app",
    ],
    credentials: true,
    optionSuccessStatus: 200,
  })
);
app.use(express.json());
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0sp.xsshgji.mongodb.net/?appName=Cluster0SP`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("travel each");
});

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .send({ message: "Unauthorized Access: No Token Provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res
      .status(401)
      .send({ message: "Unauthorized Access: Invalid Token" });
  }
};

async function run() {
  try {
    //  await client.connect();

    const db = client.db("travel_db");
    // await client.db("admin").command({ ping: 1 });

    const userscollection = db.collection("users");
    const vehiclescollection = db.collection("vehicles");
    const bookingscollection = db.collection("bookings");
    const newsletterCollection = db.collection("newsletter");
    const paymentsCollection = db.collection("payments");
    const notificationsCollection = db.collection("notifications");
    const wishlistCollection = db.collection("wish");
    const reviewsCollection = db.collection("reviews");
    const promotionCollection = db.collection("promotion");
    const webReviewsCollection= db.collection("web-reviews")
    // Verify
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const query = { email: email };
      const user = await userscollection.findOne(query);
      if (user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden Access: Admins Only" });
      }
      next();
    };

    const verifyHost = async (req, res, next) => {
      const email = req.tokenEmail;
      const query = { email: email };
      const user = await userscollection.findOne(query);
      if (user?.role !== "host" && user?.role !== "admin") {
        return res
          .status(403)
          .send({ message: "Forbidden Access: Hosts Only" });
      }
      next();
    };
    // userscollection
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const cursor = userscollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email.toLowerCase();
      const query = { email: email };
      const user = await userscollection.findOne(query);

      res.send({ role: user?.role || "user" });
    });
    app.post("/users", async (req, res) => {
      const newUser = req.body;
      const email = req.body.email;
      const query = { email: email };
      const userexisting = await userscollection.findOne(query);
      if (userexisting) {
        return res
          .status(400)
          .send({ message: "User already exists. Do not insert again!" });
      } else {
        const result = await userscollection.insertOne(newUser);
        const admins = await userscollection
          .find({ role: "admin" }, { projection: { email: 1 } })
          .toArray();
        const adminNotifs = admins.map((admin) => ({
          receiverEmail: admin.email,
          title: "New User Joined!",
          message: `A new user ${newUser.email} has registered.`,
          type: "admin_alert",
          isRead: false,
          timestamp: new Date(),
          link: "/dashboard/manage-users",
        }));
        if (adminNotifs.length > 0)
          await notificationsCollection.insertMany(adminNotifs);
        res.send(result);
      }
    });
    app.patch(
      "/users/update-role/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { role } = req.body;
        const filter = { _id: new ObjectId(id) };
        const user = await userscollection.findOne(filter);
        const updatedDoc = {
          $set: { role: role },
        };
        const result = await userscollection.updateOne(filter, updatedDoc);

        if (result.modifiedCount > 0) {
          const admins = await userscollection
            .find({ role: "admin" }, { projection: { email: 1 } })
            .toArray();

          const adminNotifs = admins.map((admin) => ({
            receiverEmail: admin.email,
            title: "Role Change Alert",
            message: `User ${user.email} has been updated to ${role}.`,
            type: "system",
            isRead: false,
            timestamp: new Date(),
            link: "/dashboard/manage-users",
          }));

          const userNotif = {
            receiverEmail: user.email,
            title: "Role Updated!",
            message: `Your account access level has been updated to '${role}'.`,
            type: "system",
            isRead: false,
            timestamp: new Date(),
            link: "/dashboard/profile",
          };

          await notificationsCollection.insertMany([...adminNotifs, userNotif]);
        }
        res.send(result);
      }
    );
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email.toLowerCase();
      const { name, photo } = req.body;
      const filter = { email: email };
      const updatedDoc = {
        $set: {
          name: name,
          photo: photo,
        },
      };
      const result = await userscollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // Subscriber collection
    app.post("/subscribe", async (req, res) => {
      const { email } = req.body;

      if (!email) {
        return res.status(400).send({ message: "Email is required!" });
      }

      const existing = await newsletterCollection.findOne({ email });
      if (existing) {
        return res.status(400).send({
          message: "You are already subscribed to our elite updates!",
        });
      }

      const result = await newsletterCollection.insertOne({
        email,
        subscribedAt: new Date(),
      });

      res.send({
        success: true,
        message: "Welcome to the Elite Circle!",
        insertedId: result.insertedId,
      });
    });

    app.get("/subscribers", async (req, res) => {
      const cursor = newsletterCollection.find().sort({ subscribedAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // paymentsCollection

    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;
      if (!price) return res.status(400).send({ message: "Price is required" });

      const amount = parseInt(price * 100); // Cents e convert

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
      } catch (err) {
        res.status(500).send({ error: err.message });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;

      const paymentResult = await paymentsCollection.insertOne(payment);

      const filter = { _id: new ObjectId(payment.bookingId) };
      const updatedDoc = {
        $set: {
          status: "Paid",
          transactionId: payment.transactionId,
          paidAt: new Date(),
        },
      };

      const bookingUpdateResult = await bookingscollection.updateOne(
        filter,
        updatedDoc
      );

      const vehicleFilter = {
        _id: new ObjectId(payment.bookingDetails.vehicleId),
      };
      await vehiclescollection.updateOne(vehicleFilter, {
        $inc: { bookingCount: 1 },
      });
      const admins = await userscollection
        .find({ role: "admin" }, { projection: { email: 1 } })
        .toArray();
      const adminEmails = admins.map((admin) => admin.email);

      const notifications = [
        {
          receiverEmail: payment.bookingDetails.userEmail,
          title: "Payment Successful!",
          message: `Your booking for ${payment.bookingDetails.vehicleName} is now confirmed.`,
          type: "payment",
          isRead: false,
          timestamp: new Date(),
          link: "/dashboard/my-bookings",
        },
        {
          receiverEmail: payment.bookingDetails.hostEmail,
          title: "Booking Paid!",
          message: `The request for your ${payment.bookingDetails.vehicleName} has been paid.`,
          type: "booking_confirmed",
          isRead: false,
          timestamp: new Date(),
          link: "/dashboard/overview",
        },
      ];
      adminEmails.forEach((email) => {
        notifications.push({
          receiverEmail: email,
          title: "New Transaction",
          message: `A payment of $${payment.bookingDetails.price} was received from ${payment.bookingDetails.userEmail}.`,
          type: "admin_alert",
          isRead: false,
          timestamp: new Date(),
          link: "/dashboard/overview",
        });
      });

      await notificationsCollection.insertMany(notifications);

      res.send({ paymentResult, bookingUpdateResult });
    });

   app.get("/vehicles", async (req, res) => {
  try {
    const { search, category, sortBy } = req.query;
    
    let matchQuery = { status: "verified" };
    
    if (search) {
      matchQuery.$or = [
        { vehicleName: { $regex: search, $options: "i" } },
        { categories: { $regex: search, $options: "i" } }, 
        { location: { $regex: search, $options: "i" } },
      ];
    }
    
    if (category) {
      matchQuery.categories = category;
    }

    let sortQuery = { _id: -1 }; 
    if (sortBy === "price-asc") sortQuery = { pricePerDay: 1 };
    else if (sortBy === "price-desc") sortQuery = { pricePerDay: -1 };
    else if (sortBy === "rating") sortQuery = { ratings: -1 };

    const result = await vehiclescollection.aggregate([
      { $match: matchQuery },
      {
        $lookup: {
          from: "promotion", 
          let: { vId: { $toString: "$_id" } },
          pipeline: [
            { 
              $match: { 
                $expr: { 
                  $and: [
                    { $eq: ["$vehicleId", "$$vId"] }, 
                    { $eq: ["$status", "approved"] }
                  ]
                }
              }
            }
          ],
          as: "activePromo"
        }
      },
      {
        $addFields: {
          promo: { $arrayElemAt: ["$activePromo", 0] },
          ratings: { $ifNull: ["$ratings", 0] }
        }
      },
      { $project: { activePromo: 0 } },
      { $sort: sortQuery }
    ]).toArray();

    res.send(result);
  } catch (error) {
    console.error("Aggregation Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});
    
    app.get("/vehicles/top", async (req, res) => {
  try {
    const result = await vehiclescollection.aggregate([
      { $match: { status: "verified" } },
      { $sort: { bookingCount: -1 } },
      { $limit: 4 },
      {
        $lookup: {
          from: "promotion",
          let: { vId: { $toString: "$_id" } },
          pipeline: [
            { $match: { $expr: { $and: [
              { $eq: ["$vehicleId", "$$vId"] },
              { $eq: ["$status", "approved"] }
            ] } } }
          ],
          as: "activePromo"
        }
      },
      {
        $addFields: {
          promo: { $arrayElemAt: ["$activePromo", 0] },
          ratings: { $ifNull: ["$ratings", 0] }
        }
      },
      { $project: { activePromo: 0 } }
    ]).toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching top vehicles" });
  }
});

    app.post("/vehicles", verifyToken, verifyHost, async (req, res) => {
      const newVehicle = req.body;
      const result = await vehiclescollection.insertOne(newVehicle);
      res.send(result);
    });
    app.delete("/vehicles/:id", verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclescollection.deleteOne(query);
      res.send(result);
    });
    app.patch("/vehicles/:id", async (req, res) => {
      const updateVehicles = req.body;
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const updatedata = {
        $set: updateVehicles,
      };
      const result = await vehiclescollection.updateOne(query, updatedata);
      res.send(result);
    });
    app.get("/related-vehicles", async (req, res) => {
      const { category, currentId } = req.query;

      const query = {
        categories: category,
        _id: { $ne: new ObjectId(currentId) },
      };

      const result = await vehiclescollection.find(query).limit(3).toArray();

      res.send(result);
    });

    // Statistics API
app.get("/site-stats", async (req, res) => {
  try {
    const totalVehicles = await vehiclescollection.countDocuments({ status: "verified" });

    const totalHappyCustomers = await paymentsCollection.countDocuments();

    const totalSubscriptions = await newsletterCollection.countDocuments();

    const reviewStats = await webReviewsCollection.aggregate([
      { $match: { status: "approved" } },
      {
        $group: {
          _id: null,
          averageRating: { $avg: "$rating" },
          totalReviews: { $sum: 1 }
        }
      }
    ]).toArray();

    const avgRating = reviewStats.length > 0 ? reviewStats[0].averageRating.toFixed(1) : "0.0";

    res.send({
      totalVehicles,
      totalHappyCustomers,
      totalSubscriptions,
      avgRating
    });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch stats" });
  }
});

    // --- Wishlist APIs ---

    app.patch("/wishlist/toggle", async (req, res) => {
      const { vehicleId, userEmail, action } = req.body;
      const vQuery = { _id: new ObjectId(vehicleId) };

      try {
        const updateDoc = {
          $inc: { wish: action === "add" ? 1 : -1 },
        };
        await vehiclescollection.updateOne(vQuery, updateDoc);

        if (userEmail) {
          if (action === "add") {
            const wishDoc = { vehicleId, userEmail, addedAt: new Date() };
            await wishlistCollection.insertOne(wishDoc);
          } else {
            await wishlistCollection.deleteOne({ vehicleId, userEmail });
          }
        }

        res.send({ success: true, message: `Wishlist ${action} successful` });
      } catch (err) {
        res.status(500).send({ message: err.message });
      }
    });

    app.get("/my-wishlist/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const result = await wishlistCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    app.get("/wishlist-items/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const wishItems = await wishlistCollection
        .find({ userEmail: email })
        .toArray();
      const vehicleIds = wishItems.map((item) => new ObjectId(item.vehicleId));
      const result = await vehiclescollection
        .find({ _id: { $in: vehicleIds } })
        .toArray();
      res.send(result);
    });

app.get("/active-promotion", async (req, res) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const expiredPromo = await promotionCollection.findOne({
      status: "approved",
      createdAt: { $lt: sevenDaysAgo },
      isExpiryNotified: { $ne: true } 
    });

    if (expiredPromo) {
      const admins = await userscollection
        .find({ role: "admin" }, { projection: { email: 1 } })
        .toArray();
      const adminEmails = admins.map((admin) => admin.email);

      const expiryNotifications = [
        {
          receiverEmail: expiredPromo.hostEmail,
          title: "Promotion Expired!",
          message: `Your special offer for ${expiredPromo.vehicleName} has ended after 7 days.`,
          type: "promo_expired",
          isRead: false,
          timestamp: new Date(),
          link: "/",
        }
      ];

      adminEmails.forEach((email) => {
        expiryNotifications.push({
          receiverEmail: email,
          title: "Promo Ended",
          message: `The promotion for ${expiredPromo.vehicleName} by ${expiredPromo.hostEmail} has expired.`,
          type: "admin_alert",
          isRead: false,
          timestamp: new Date(),
          link: "/dashboard/manage-promotions",
        });
      });

      await notificationsCollection.insertMany(expiryNotifications);

      await promotionCollection.updateOne(
        { _id: expiredPromo._id },
        { $set: { isExpiryNotified: true, status: "expired" } }
      );
    }

    const result = await promotionCollection
      .find({
        status: "approved",
        createdAt: { $gte: sevenDaysAgo }
      })
      .sort({ createdAt: -1 })
      .limit(1)
      .toArray();

    res.send(result[0] || {});

  } catch (error) {
    console.error("Promo Fetch & Expiry Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

    // user dashboard

    app.post("/bookings", verifyToken, async (req, res) => {
      if (req.tokenEmail !== req.body.userEmail) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const newBooking = req.body;

      const query = {
        userEmail: newBooking.userEmail,
        vehicleId: newBooking.vehicleId,
        status: { $in: ["Pending", "Accepted", "Paid"] },
      };

      const existing = await bookingscollection.findOne(query);

      if (existing) {
        return res.status(400).send({
          message:
            "You already have an active request or booking for this vehicle!",
        });
      }

      const bookingData = {
        ...newBooking,
        status: "Pending",
        requestDate: new Date(),
      };

      const result = await bookingscollection.insertOne(bookingData);

      const hostNotification = {
        receiverEmail: newBooking.hostEmail,
        title: "New Rental Request",
        message: `${newBooking.userName} wishes to rent your ${newBooking.vehicleName}.`,
        type: "request",
        isRead: false,
        timestamp: new Date(),
        link: "/dashboard/booking-requests",
      };

      await notificationsCollection.insertOne(hostNotification);

      res.send({
        success: true,
        message: "Request sent to host successfully!",
        insertedId: result.insertedId,
      });
    });

    app.get("/booking-details/:id", verifyToken, async (req, res) => {
      try {
    const id = req.params.id;
    
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid Booking ID" });
    }

    const query = { _id: new ObjectId(id) };
    const result = await bookingscollection.findOne(query);

    if (!result) {
      return res.status(404).send({ message: "Booking not found" });
    }

    const userEmail = req.tokenEmail; 
    if (result.userEmail !== userEmail && result.hostEmail !== userEmail) {
      return res.status(403).send({ message: "Access Denied! This is not your booking." });
    }

    res.send(result);
  } catch (error) {
    console.error("Booking Details Error:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

    app.get("/user-overview/:email", verifyToken, async (req, res) => {
      const email = req.params.email.toLowerCase();
      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      try {
        const paidBookings = await bookingscollection.find({ userEmail: email, status: "Paid" })
      .toArray();

       const totalSpent = paidBookings.reduce((sum, b) => {
      const price = parseFloat(b.price || 0);
      return sum + price;
    }, 0);

    const totalBookingsCount = paidBookings.length;

        const recentActivity = await bookingscollection
          .find({ userEmail: email })
          .sort({ _id: -1 })
          .limit(5)
          .toArray();

        const wishlistCount = await wishlistCollection.countDocuments({
      userEmail: email,
    });

        res.send({
          stats: {
            totalBookings:totalBookingsCount,
            totalSpent: totalSpent.toFixed(2),
            wishlistCount,
          },
          recentActivity,
        });
      } catch (err) {
        console.error("Overview Error:", err);
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get("/bookings", verifyToken, async (req, res) => {
      try {
      const email = req.query.email.toLowerCase();

      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const query = { userEmail: email };
      const result = await bookingscollection.find(query).sort({ _id: -1 }).toArray();
      res.send(result);
    } catch (error) {
    console.error("Fetch Bookings Error:", error);
    res.status(500).send({ message: "Failed to load bookings" });
  }
});

    app.get("/payments/:email", verifyToken, async (req, res) => {
      const email = req.params.email.toLowerCase();

      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const query = { "bookingDetails.userEmail": email };

      try {
        const result = await paymentsCollection
          .find(query)
          .sort({ _id: -1 })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Error fetching payments" });
      }
    });

    app.post("/reviews", verifyToken, async (req, res) => {
  const review = req.body;
  const vehicleId = new ObjectId(review.vehicleId);

  try {
    const hasBooked = await bookingscollection.findOne({
      vehicleId: review.vehicleId,
      userEmail: review.userEmail,
      status: { $in: ["Accepted", "Paid"] },
    });

    if (!hasBooked) {
      return res.status(403).send({ message: "Only confirmed guests can leave a review!" });
    }

    const reviewData = { ...review, createdAt: new Date() };
    await reviewsCollection.insertOne(reviewData);

    const vehicle = await vehiclescollection.findOne({ _id: vehicleId });
    
    const newTotalStars = (vehicle.totalStars || 0) + parseInt(review.rating);
    const newTotalReviews = (vehicle.totalReviews || 0) + 1;
    const newAvgRating = parseFloat((newTotalStars / newTotalReviews).toFixed(1));

    await vehiclescollection.updateOne(
      { _id: vehicleId },
      {
        $set: {
          totalStars: newTotalStars,
          totalReviews: newTotalReviews,
          ratings: newAvgRating,
        },
      }
    );

    res.send({ success: true, message: "Review published!" });
  } catch (error) {
    res.status(500).send({ message: "Error posting review" });
  }
});
    app.get("/reviews/:vehicleId", async (req, res) => {
      const result = await reviewsCollection
        .find({ vehicleId: req.params.vehicleId })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // --- Host Dashboard ---
    app.patch(
      "/bookings/accept/:id",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const booking = await bookingscollection.findOne(filter);
        if (!booking)
          return res.status(404).send({ message: "Booking not found" });

        const updateDoc = { $set: { status: "Accepted" } };
        const result = await bookingscollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          await notificationsCollection.insertOne({
            receiverEmail: booking.userEmail,
            title: "Request Approved!",
            message: `Your request for ${booking.vehicleName} has been approved. Please complete the payment.`,
            type: "approval",
            isRead: false,
            timestamp: new Date(),
            link: `/payment/${booking._id}`,
          });
        }

        res.send(result);
      }
    );
    app.get(
      "/host-overview/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email.toLowerCase();

        if (req.tokenEmail !== email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        try {
          const totalVehicles = await vehiclescollection.countDocuments({
            userEmail: email,
          });

          const paidBookings = await bookingscollection
      .find({ hostEmail: email, status: "Paid" })
      .toArray();
          const totalNetRevenue = paidBookings.reduce((sum, b) => {
            const amount = parseFloat(b.price || 0);
            const netRevenue = amount * 0.9;
            return sum + netRevenue;
          }, 0);

          const totalBookingsCount = paidBookings.length;

          const recentActivity = await bookingscollection
            .find({ hostEmail: email })
            .sort({ requestDate: -1 })
            .limit(5)
            .toArray();

          res.send({
            stats: {
              totalVehicles,
              totalBookings:totalBookingsCount,
              totalRevenue: totalNetRevenue.toFixed(2),
              activeAssets: totalVehicles,
            },
            recentActivity,
            chartData: paidBookings.map((b) => {
              const amount = parseFloat(b.price || 0);
              return {
                name: b.vehicleName?.split(" ")[0] || "Vehicle",
                revenue: Number((amount * 0.9).toFixed(2)),
                date:b.paidAt ? new Date(b.paidAt).toLocaleDateString() : "N/A",
              };
            }),
          });
        } catch (err) {
          console.error("Overview Error:", err);
          res.status(500).send({ message: "Host Stats Load Failed" });
        }
      }
    );
    app.get("/bookings/host/:email", verifyToken, async (req, res) => {
      const email = req.params.email.toLowerCase();

      if (!email || req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      try {
        const query = { hostEmail: email };
        const result = await bookingscollection
          .find(query)
          .sort({ _id: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Booking Fetch Error:", error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    app.get(
      "/vehicles/host/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        const email = req.params.email.toLowerCase();

        if (req.tokenEmail !== email) {
          return res.status(403).send({ message: "Forbidden Access" });
        }

        const query = { userEmail: { $regex: new RegExp(`^${email}$`, "i") } };
        const result = await vehiclescollection.find(query).toArray();
        res.send(result);
      }
    );
    app.patch("/vehicles/:id", verifyToken, verifyHost, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;
      const query = { _id: new ObjectId(id) };

      delete updateData._id;

      const updatedDoc = {
        $set: {
          ...updateData,
        },
      };

      const result = await vehiclescollection.updateOne(query, updatedDoc);
      res.send(result);
    });

    app.get(
      "/host-analytics/:email",
      verifyToken,
      verifyHost,
      async (req, res) => {
        try {
          const email = req.params.email.toLowerCase();

          const payments = await paymentsCollection
            .find({ "bookingDetails.hostEmail": email })
            .toArray();

          if (!payments || payments.length === 0) {
            return res.send({
              vehicleChartData: [],
              categoryChartData: [],
              monthlyChartData: [],
            });
          }

          const hostVehicles = await vehiclescollection
            .find({ userEmail: email })
            .toArray();

          const categoryMap = hostVehicles.reduce((acc, v) => {
            acc[v._id.toString()] = v.categories || "Standard";
            return acc;
          }, {});

          const vehicleRevenue = {};
          const categoryRevenue = {};
          const monthlyRevenue = {};

          payments.forEach((p) => {
            const amount = parseFloat(p.bookingDetails?.price || 0);
            const adminFee = amount * 0.1;
            const netRevenue = amount - adminFee;

            const vId = p.bookingDetails?.vehicleId;
            const vName = p.bookingDetails?.vehicleName || "Unknown";
            const cat = categoryMap[vId] || "Standard";

            const date = p.createdAt
              ? new Date(p.createdAt)
              : p._id.getTimestamp();
            const month = date.toLocaleString("default", { month: "short" });

            vehicleRevenue[vName] = (vehicleRevenue[vName] || 0) + netRevenue;
            categoryRevenue[cat] = (categoryRevenue[cat] || 0) + netRevenue;
            monthlyRevenue[month] = (monthlyRevenue[month] || 0) + netRevenue;
          });

          const vehicleChartData = Object.keys(vehicleRevenue).map((name) => ({
            name,
            value: Number(vehicleRevenue[name].toFixed(2)),
          }));

          const categoryChartData = Object.keys(categoryRevenue).map(
            (name) => ({
              name,
              value: Number(categoryRevenue[name].toFixed(2)),
            })
          );

          const monthlyChartData = Object.keys(monthlyRevenue).map((name) => ({
            name,
            revenue: Number(monthlyRevenue[name].toFixed(2)),
          }));

          res.send({ vehicleChartData, categoryChartData, monthlyChartData });
        } catch (error) {
          console.error("Host Analytics Error:", error);
          res.status(500).send({ message: "Host analytics load failed" });
        }
      }
    );

app.post(
  "/request-promotion",
  verifyToken,
  verifyHost,
  async (req, res) => {
    const promoData = req.body;
    
    const result = await promotionCollection.insertOne({
      ...promoData,
      status: "pending",
      createdAt: new Date(),
    });

    if (result.insertedId) {
      const admins = await userscollection
        .find({ role: "admin" }, { projection: { email: 1 } })
        .toArray();
      const adminEmails = admins.map((admin) => admin.email);

      const adminNotifications = adminEmails.map((email) => ({
        receiverEmail: email, 
        title: "New Promotion Request! 🚀",
        message: `Host ${promoData.hostEmail} has requested a promotion for '${promoData.vehicleName}'.`,
        type: "admin_alert",
        isRead: false,
        timestamp: new Date(),
        link: "/dashboard/manage-promotions",
      }));

      if (adminNotifications.length > 0) {
        await notificationsCollection.insertMany(adminNotifications);
      }
    }

    res.send(result);
  }
);
    // --- Admin Dashboard ---
    app.get("/admin-overview", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await userscollection.countDocuments();
        const totalVehicles = await vehiclescollection.countDocuments();
        const totalBookings = await bookingscollection.countDocuments({ status: "Paid" });
        const totalSubscribers = await newsletterCollection.countDocuments();

        const allPayments = await paymentsCollection.find().toArray();
        const totalRevenue = allPayments.reduce(
          (sum, p) => sum + parseFloat(p.bookingDetails?.price || 0),
          0
        );

        const userRoles = await userscollection
          .aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }])
          .toArray();

        const recentTransactions = await paymentsCollection
          .find()
          .sort({ _id: -1 })
          .limit(6)
          .toArray();

        res.send({
          stats: {
            totalUsers,
            totalVehicles,
            totalBookings,
            totalRevenue: totalRevenue.toFixed(2),
            totalSubscribers,
          },
          userRoles,
          recentTransactions,
        });
      } catch (err) {
        console.error("Admin Stats Error:", err);
        res.status(500).send({ message: "Global Stats Load Failed" });
      }
    });

    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await userscollection.deleteOne(query);
      res.send(result);
    });

    app.patch(
      "/users/status/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { status: status } };
        const result = await userscollection.updateOne(filter, updatedDoc);
        res.send(result);
      }
    );

    app.get("/vehicles/pending", verifyToken, verifyAdmin, async (req, res) => {
      const result = await vehiclescollection
        .find({ status: "pending" })
        .toArray();
      res.send(result);
    });

    app.get("/vehicles/:id",  async (req, res) => {
      try {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) {
          return res.status(400).send({ message: "Invalid ID format" });
        }
        const result = await vehiclescollection.aggregate([
      { $match: { _id: new ObjectId(id) } },
      {
        $lookup: {
          from: "promotion", 
          let: { vId: { $toString: "$_id" } },
          pipeline: [
            { 
              $match: { 
                $expr: { 
                  $and: [
                    { $eq: ["$vehicleId", "$$vId"] }, 
                    { $eq: ["$status", "approved"] } 
                  ]
                }
              }
            }
          ],
          as: "activePromo"
        }
      },
      {
        $addFields: {
          promo: { $arrayElemAt: ["$activePromo", 0] } 
        }
      },
      { $project: { activePromo: 0 } } 
    ]).toArray();

    if (result.length === 0) return res.status(404).send({ message: "Not found" });
    
    res.send(result[0]);
  } catch (error) {
        res.status(500).send(error);
      }
    });

    app.patch(
      "/vehicles/approve/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

        const filter = { _id: new ObjectId(id) };
        const vehicle = await vehiclescollection.findOne(filter);

        if (!vehicle) return res.status(404).send("Vehicle not found");

        const updateDoc = { $set: { status: "verified" } };
        const result = await vehiclescollection.updateOne(filter, updateDoc);

        if (result.modifiedCount > 0) {
          await notificationsCollection.insertOne({
            receiverEmail: vehicle.userEmail,
            title: "Vehicle Verified! ✅",
            message: `Your asset '${vehicle.vehicleName}' has been approved and is now live.`,
            type: "system",
            isRead: false,
            timestamp: new Date(),
            link: "/dashboard/my-listings",
          });
        }
        res.send(result);
      }
    );

    app.delete(
      "/vehicles/admin-delete/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        if (!ObjectId.isValid(id)) return res.status(400).send("Invalid ID");

        const filter = { _id: new ObjectId(id) };
        const vehicle = await vehiclescollection.findOne(filter);

        if (!vehicle) return res.status(404).send("Vehicle not found");

        const result = await vehiclescollection.deleteOne(filter);

        if (result.deletedCount > 0) {
          await notificationsCollection.insertOne({
            receiverEmail: vehicle.userEmail,
            title: "Vehicle Rejected ❌",
            message: `Your asset '${vehicle.vehicleName}' did not meet our standards.`,
            type: "alert",
            isRead: false,
            timestamp: new Date(),
          });
        }
        res.send(result);
      }
    );

    app.get(
      "/admin/all-bookings",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await bookingscollection
          .find({ status: "Paid" })
          .sort({ requestDate: -1 })
          .toArray();
        res.send(result);
      }
    );

    app.delete(
      "/admin/bookings/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await bookingscollection.deleteOne(query);
        res.send(result);
      }
    );

    app.get(
      "/admin-revenue-analytics",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const payments = await paymentsCollection.find().toArray();
          const vehicles = await vehiclescollection.find().toArray();
          const hosts = await userscollection.find({ role: "host" }).toArray();

          const vehicleMap = vehicles.reduce((acc, v) => {
            acc[v._id.toString()] = { cat: v.categories, brand: v.brand };
            return acc;
          }, {});

          const COMMISSION_RATE = 0.1;
          const monthlyTotal = {};
          const monthlyAdmin = {};
          const categoryMonthly = {};
          const brandMonthly = {};
          const hostLifetime = {};

          payments.forEach((p) => {
            const amount = parseFloat(p.bookingDetails?.price || 0);
            const adminFee = amount * COMMISSION_RATE;
            const hEmail = p.bookingDetails?.hostEmail;
            const vId = p.bookingDetails?.vehicleId;
            const vInfo = vehicleMap[vId] || {
              cat: "Standard",
              brand: "Other",
            };

            const date = p.createdAt
              ? new Date(p.createdAt)
              : p._id.getTimestamp();
            const month = date.toLocaleString("default", { month: "short" });

            monthlyTotal[month] = (monthlyTotal[month] || 0) + amount;
            monthlyAdmin[month] = (monthlyAdmin[month] || 0) + adminFee;

            const catKey = `${month}-${vInfo.cat}`;
            categoryMonthly[catKey] = (categoryMonthly[catKey] || 0) + amount;

            const brandKey = `${month}-${vInfo.brand}`;
            brandMonthly[brandKey] = (brandMonthly[brandKey] || 0) + amount;

            hostLifetime[hEmail] = (hostLifetime[hEmail] || 0) + amount;
          });

          const adminCommissionData = Object.keys(monthlyAdmin).map((m) => ({
            month: m,
            commission: monthlyAdmin[m],
          }));
          const totalRevenueData = Object.keys(monthlyTotal).map((m) => ({
            month: m,
            total: monthlyTotal[m],
          }));

          const catChartData = Object.keys(categoryMonthly).map((key) => ({
            name: key.split("-")[1],
            month: key.split("-")[0],
            value: categoryMonthly[key],
          }));

          const brandChartData = Object.keys(brandMonthly).map((key) => ({
            name: key.split("-")[1],
            value: brandMonthly[key],
          }));

          const hostChartData = Object.keys(hostLifetime).map((email) => ({
            host: email.split("@")[0],
            revenue: hostLifetime[email],
          }));

          res.send({
            adminCommissionData,
            totalRevenueData,
            catChartData,
            brandChartData,
            hostChartData,
          });
        } catch (error) {
          res.status(500).send({ message: "Revenue load failed" });
        }
      }
    );
app.get("/admin/promotions", verifyToken, verifyAdmin, async (req, res) => {
    const result = await promotionCollection.find().sort({ createdAt: -1 }).toArray();
    res.send(result);
});

   app.patch("/admin/approve-promo/:id", verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };

    const promo = await promotionCollection.findOne(filter);
    if (!promo) return res.status(404).send({ message: "Promotion not found" });

    await promotionCollection.updateMany({ status: 'approved' }, { $set: { status: 'expired' } }); 

    const updateDoc = { $set: { status: 'approved' } };
    const result = await promotionCollection.updateOne(filter, updateDoc);

    if (result.modifiedCount > 0) {
        await notificationsCollection.insertOne({
            receiverEmail: promo.hostEmail,
            title: "Promotion Approved! 🔥",
            message: `Good news! Your promotion for '${promo.vehicleName}' is now live on the home banner.`,
            type: "success",
            isRead: false,
            timestamp: new Date(),
            link: "/",
        });
    }

    res.send(result);
});

app.delete("/admin/reject-promo/:id", verifyToken, verifyAdmin, async (req, res) => {
    const id = req.params.id;
    const filter = { _id: new ObjectId(id) };

    const promo = await promotionCollection.findOne(filter);
    if (!promo) return res.status(404).send({ message: "Promotion not found" });

    const result = await promotionCollection.deleteOne(filter);

    if (result.deletedCount > 0) {
        await notificationsCollection.insertOne({
            receiverEmail: promo.hostEmail,
            title: "Promotion Rejected ⚠️",
            message: `Your promotion request for '${promo.vehicleName}' was not approved by admin.`,
            type: "alert",
            isRead: false,
            timestamp: new Date(),
        });
    }

    res.send(result);
});

   // web review

app.post("/web-reviews", verifyToken, async (req, res) => {
  try {
    const { email, text, rating } = req.body;

    const userData = await userscollection.findOne({ email });
    if (!userData) return res.status(404).send({ message: "User profile not found" });

    const newReview = {
      name: userData.name,
      email: userData.email,
      img: userData.photo || "https://i.pravatar.cc/150",
      role: `Verified ${userData.role.charAt(0).toUpperCase() + userData.role.slice(1)}`,
      text,
      rating,
      status: "pending",
      createdAt: new Date()
    };

    const result = await webReviewsCollection.insertOne(newReview);

    const admins = await userscollection
      .find({ role: "admin" }, { projection: { email: 1 } })
      .toArray();
    
    if (admins.length > 0) {
      const adminNotifications = admins.map((admin) => ({
        receiverEmail: admin.email,
        title: "New Web Review!",
        message: `${newReview.name} (${newReview.role}) gave a ${rating}-star review.`,
        type: "admin_alert",
        isRead: false,
        timestamp: new Date(),
        link: "/dashboard/manage-reviews",
      }));
      await notificationsCollection.insertMany(adminNotifications);
    }

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Internal Server Error" });
  }
});



app.get("/web-reviews",verifyToken, verifyAdmin, async (req, res) => {
  const result = await webReviewsCollection
    .find()
    .sort({ createdAt: -1 })
    .toArray();
  res.send(result);
});

app.get("/approved-reviews", async (req, res) => {
  try {
    const query = { status: "approved" };
    const result = await webReviewsCollection
      .find(query)
      .sort({ createdAt: -1 }) 
      .limit(12)              
      .toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch home reviews" });
  }
});
app.patch("/web-reviews/:id",verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    const filter = { _id: new ObjectId(id) };
    const updateDoc = {
      $set: { status: status },
    };
    const result = await webReviewsCollection.updateOne(filter, updateDoc);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Update failed" });
  }
});

app.delete("/web-reviews/:id",verifyToken, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const query = { _id: new ObjectId(id) };
    const result = await webReviewsCollection.deleteOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Delete failed" });
  }
});
    // --- NOTIFICATIONS SYSTEM ---

    app.get("/notifications/:email", verifyToken, async (req, res) => {
      const email = req.params.email.toLowerCase();
      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const query = { receiverEmail: email };
      const result = await notificationsCollection
        .find(query)
        .sort({ timestamp: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/notifications/read/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = { $set: { isRead: true } };
      const result = await notificationsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch(
      "/notifications/read-all/:email",
      verifyToken,
      async (req, res) => {
        const email = req.params.email.toLowerCase();
        const filter = { receiverEmail: email, isRead: false };
        const updateDoc = { $set: { isRead: true } };
        const result = await notificationsCollection.updateMany(
          filter,
          updateDoc
        );
        res.send(result);
      }
    );
    
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log("server connected", port);
});
