const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;
app.use(cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:5174",
      "https://travel-ease-drab.vercel.app"
    ],
    credentials: true,
    optionSuccessStatus: 200,
  }));
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
      const { search, category, sortBy } = req.query;
      let query = {};
      if (search) {
        query = {
          $or: [
            { vehicleName: { $regex: search, $options: "i" } },
            {
              category: { $regex: search, $options: "i" },
            },
            { location: { $regex: search, $options: "i" } },
          ],
        };
      }
      if (category) {
        query.categories = category;
      }

      let sortQuery = {};
      if (sortBy === "price-asc") sortQuery = { pricePerDay: 1 };
      else if (sortBy === "price-desc") sortQuery = { pricePerDay: -1 };

      const cursor = vehiclescollection.find(query).sort(sortQuery);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/vehicles/latest", async (req, res) => {
      const cursor = vehiclescollection.find().sort({ createdAt: -1 }).limit(4);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/vehicles/top", async (req, res) => {
      const cursor = vehiclescollection
        .find()
        .sort({ bookingCount: -1 })
        .limit(4);
      const result = await cursor.toArray();
      res.send(result);
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
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await bookingscollection.findOne(query);
  res.send(result);
});

    app.get("/user-overview/:email", verifyToken, async (req, res) => {
      const email = req.params.email.toLowerCase();
      if (req.tokenEmail !== email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      try {
        const totalBookings = await bookingscollection.countDocuments({
          userEmail: email,
        });
        const payments = await paymentsCollection
          .find({ "bookingDetails.userEmail": email })
          .toArray();
        if (payments.length > 0) {
          console.log(
            "First Payment Price Path:",
            payments[0].bookingDetails?.price
          );
        }

        const totalSpent = payments.reduce((sum, p) => {
          const price = parseFloat(p.bookingDetails?.price || 0);
          return sum + price;
        }, 0);

        const recentActivity = await bookingscollection
          .find({ userEmail: email })
          .sort({ _id: -1 })
          .limit(5)
          .toArray();

        const favoriteCategory = await bookingscollection
          .aggregate([
            { $match: { userEmail: email } },
            { $group: { _id: "$category", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 1 },
          ])
          .toArray();

        res.send({
          stats: {
            totalBookings,
            totalSpent: totalSpent.toFixed(2),
            favCategory: favoriteCategory[0]?._id || "None",
          },
          recentActivity,
        });
      } catch (err) {
        console.error("Overview Error:", err);
        res.status(500).send({ message: "Server Error" });
      }
    });

    app.get("/bookings", verifyToken, async (req, res) => {
  const email = req.query.email.toLowerCase();

  if (req.tokenEmail !== email) {
    return res.status(403).send({ message: "Forbidden Access" });
  }

  const query = { userEmail: email };
  const result = await bookingscollection.find(query).toArray();
  res.send(result);
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

          const hostVehicles = await vehiclescollection
            .find(
              { userEmail: email },
              { projection: { _id: 1, vehicleName: 1 } }
            )
            .toArray();
          const vehicleIds = hostVehicles.map((v) => v._id.toString());

          const hostPayments = await paymentsCollection
            .find({
              "bookingDetails.vehicleId": { $in: vehicleIds },
            })
            .toArray();

          const totalRevenue = hostPayments.reduce(
            (sum, p) => sum + parseFloat(p.bookingDetails?.price || 0),
            0
          );
          const totalBookings = hostPayments.length;

          const recentActivity = await bookingscollection
            .find({
              vehicleId: { $in: vehicleIds },
            })
            .sort({ _id: -1 })
            .limit(5)
            .toArray();

          res.send({
            stats: {
              totalVehicles,
              totalBookings,
              totalRevenue: totalRevenue.toFixed(2),
              activeAssets: hostVehicles.length,
            },
            recentActivity,
            chartData: hostPayments.map((p) => ({
              name: p.bookingDetails?.vehicleName?.split(" ")[0],
              price: p.bookingDetails?.price,
              date: p.transactionId?.slice(-5),
            })),
          });
        } catch (err) {
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

    app.get("/vehicles/host/:email", verifyToken, verifyHost, async (req, res) => {
  const email = req.params.email.toLowerCase();

  if (req.tokenEmail !== email) {
    return res.status(403).send({ message: "Forbidden Access" });
  }

  const query = { userEmail: { $regex: new RegExp(`^${email}$`, "i") } }; 
  const result = await vehiclescollection.find(query).toArray();
  res.send(result);
});
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

app.get("/host-analytics/:email", verifyToken, verifyHost, async (req, res) => {
    try {
        const email = req.params.email.toLowerCase();
        
        const hostVehicles = await vehiclescollection.find({ userEmail: email }).toArray();
        const vehicleIds = hostVehicles.map(v => v._id.toString());
        
        const categoryMap = hostVehicles.reduce((acc, v) => {
            acc[v._id.toString()] = v.categories || "Standard";
            return acc;
        }, {});

        const payments = await paymentsCollection.find({
            "bookingDetails.vehicleId": { $in: vehicleIds }
        }).toArray();

        const vehicleRevenue = {};
        const categoryRevenue = {};
        const monthlyRevenue = {};

        payments.forEach(p => {
            const price = parseFloat(p.bookingDetails?.price || 0);
            const vName = p.bookingDetails?.vehicleName || "Unknown";
            const vId = p.bookingDetails?.vehicleId;
            const cat = categoryMap[vId] || "Standard";
            
            const date = p.createdAt ? new Date(p.createdAt) : new Date(parseInt(p._id.toString().substring(0, 8), 16) * 1000);
            const month = date.toLocaleString('default', { month: 'short' });

            vehicleRevenue[vName] = (vehicleRevenue[vName] || 0) + price;
            categoryRevenue[cat] = (categoryRevenue[cat] || 0) + price;
            monthlyRevenue[month] = (monthlyRevenue[month] || 0) + price;
        });

        const vehicleChartData = Object.keys(vehicleRevenue).map(name => ({ name, value: vehicleRevenue[name] }));
        const categoryChartData = Object.keys(categoryRevenue).map(name => ({ name, value: categoryRevenue[name] }));
        const monthlyChartData = Object.keys(monthlyRevenue).map(name => ({ name, revenue: monthlyRevenue[name] }));

        res.send({ vehicleChartData, categoryChartData, monthlyChartData });
    } catch (error) {
        res.status(500).send({ message: "Analytics load failed" });
    }
});
    // --- Admin Dashboard ---
    app.get("/admin-overview", verifyToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await userscollection.countDocuments();
        const totalVehicles = await vehiclescollection.countDocuments();
        const totalBookings = await bookingscollection.countDocuments();
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

app.patch("/users/status/:id", verifyToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body; 
  const filter = { _id: new ObjectId(id) };
  const updatedDoc = { $set: { status: status } };
  const result = await userscollection.updateOne(filter, updatedDoc);
  res.send(result);
});

app.get("/vehicles/pending", verifyToken, verifyAdmin, async (req, res) => {
  const result = await vehiclescollection.find({ status: "pending" }).toArray();
  res.send(result);
});

app.get("/vehicles/:id", verifyToken, async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ message: "Invalid ID format" });
    }
    const query = { _id: new ObjectId(id) };
    const result = await vehiclescollection.findOne(query);
    res.send(result);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.patch("/vehicles/approve/:id", verifyToken, verifyAdmin, async (req, res) => {
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
});

app.delete("/vehicles/admin-delete/:id", verifyToken, verifyAdmin, async (req, res) => {
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
