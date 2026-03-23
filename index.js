const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const admin = require("firebase-admin");
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
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
    return res.status(401).send({ message: "Unauthorized Access: No Token Provided" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email; 
    next();
  } catch (err) {
    return res.status(401).send({ message: "Unauthorized Access: Invalid Token" });
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
    const paymentsCollection = db.collection("payments")
    
// Verify
    const verifyAdmin = async (req, res, next) => {
  const email = req.tokenEmail;
  const query = { email: email };
  const user = await userscollection.findOne(query);
  if (user?.role !== "admin") {
    return res.status(403).send({ message: "Forbidden Access: Admins Only" });
  }
  next();
};

const verifyHost = async (req, res, next) => {
  const email = req.tokenEmail;
  const query = { email: email };
  const user = await userscollection.findOne(query);
  if (user?.role !== "host" && user?.role !== "admin") {
    return res.status(403).send({ message: "Forbidden Access: Hosts Only" });
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
      const email = req.params.email;
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
        res.send(result);
      }
    });
    app.patch("/users/update-role/:id", async (req, res) => {
      const id = req.params.id;
      const { role } = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: { role: role },
      };
      const result = await userscollection.updateOne(filter, updatedDoc);
      res.send(result);
    });
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
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
        return res
          .status(400)
          .send({
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

  const bookingData = {
    ...payment.bookingDetails,
    transactionId: payment.transactionId,
    status: "Paid",
    paidAt: new Date()
  };
  
  const bookingResult = await bookingscollection.insertOne(bookingData);

  const filter = { _id: new ObjectId(payment.bookingDetails.vehicleId) };
  await vehiclescollection.updateOne(filter, { $inc: { bookingCount: 1 } });

  res.send({ paymentResult, bookingResult });
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
    app.get("/vehicles/users", async (req, res) => {
      const email = req.query.email;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const cursor = vehiclescollection.find(query);
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
    app.get("/vehicles/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await vehiclescollection.findOne(query);
      res.send(result);
    });
    app.post("/vehicles",verifyToken, verifyHost, async (req, res) => {
      const newVehicle = req.body;
      const result = await vehiclescollection.insertOne(newVehicle);
      res.send(result);
    });
    app.delete("/vehicles/:id",verifyToken, verifyHost, async (req, res) => {
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
    app.get("/bookings", async (req, res) => {
      console.log(req.query);

      const email = req.query.email;
      const query = {};
      if (email) {
        query.userEmail = email;
      }
      const cursor = bookingscollection.find(query);
      const result = await cursor.toArray();
      res.send(result);
    });
    app.get("/user-stats/:email", async (req, res) => {
      const email = req.params.email;

      const totalVehicles = await vehiclescollection.countDocuments({
        userEmail: email,
      });

      const totalBookings = await bookingscollection.countDocuments({
        userEmail: email,
      });

      const userVehicles = await vehiclescollection
        .find({ userEmail: email })
        .project({ vehicleName: 1, bookingCount: 1, pricePerDay: 1 })
        .limit(5)
        .toArray();

      const chartData = userVehicles.map((v) => ({
        name: v.vehicleName,
        bookings: v.bookingCount || 0,
        price: v.pricePerDay || 0,
      }));

      res.send({
        totalVehicles,
        totalBookings,
        chartData,
      });
    });
    app.post("/bookings", verifyToken, async (req, res) => {
      if (req.tokenEmail !== req.body.userEmail) {
    return res.status(403).send({ message: "Forbidden Access" });
  }
      const newBooking = req.body;
      const query = {
        userEmail: newBooking.userEmail,
        vehicleId: newBooking.vehicleId,
      };

      const vehcleexisting = await bookingscollection.findOne(query);
      if (vehcleexisting) {
        return res
          .status(400)
          .send({ message: "You have already booked this vehicle!" });
      } else {
        const result = await bookingscollection.insertOne(newBooking);
        const filter = { _id: new ObjectId(newBooking.vehicleId) };
        const updateDoc = {
          $inc: { bookingCount: 1 },
        };

        await vehiclescollection.updateOne(filter, updateDoc);
        res.send({
          success: true,
          insertedId: result.insertedId,
        });
      }
    });
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log("server connected", port);
});
