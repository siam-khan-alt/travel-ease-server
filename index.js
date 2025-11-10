const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()

const app = express()
const port = process.env.PORT || 3000
app.use(cors())
app.use(express.json())


const uri =`mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0sp.xsshgji.mongodb.net/?appName=Cluster0SP`
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


app.get('/', (req, res)=>{
    res.send('travel each')
})


async function run() {
  try {

    await client.connect();
    const db = client.db('travel_db')
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");

       const userscollection = db.collection('users')
       const vehiclescollection = db.collection('vehicles')
    app.get('/users', async(req,res)=>{
        const cursor = userscollection.find()
        const result = await cursor.toArray()
        res.send(result)
    })
    app.post('/users', async(req, res)=>{
        const newUser = req.body
        const email = req.body.email
        const query = {email: email}
        const userexisting= await userscollection.findOne(query)
        if(userexisting){
          return res.status(400).send({ message: 'User already exists. Do not insert again!' });
      }
        else{
         const result = await userscollection.insertOne(newUser)
        res.send(result)
        }
        })
        app.get('/vehicles', async(req, res)=>{
      
      const cursor = vehiclescollection.find()
      const result = await cursor.toArray()
      res.send(result)
    })
    app.get('/vehicles/users', async(req, res)=>{
       const email = req.query.email
        const query={}
        if(email){
            query.userEmail=email
        }
      const cursor = vehiclescollection.find(query)
      const result = await cursor.toArray()
      res.send(result)
    })
    app.get('/vehicles/latest', async(req, res)=>{
      const cursor = vehiclescollection.find().sort({createdAt: 1}).limit(6)
      const result = await cursor.toArray()
      res.send(result)
    })
    app.get('/vehicles/:id', async(req, res)=>{
     const id = req.params.id
     const query = {_id: new ObjectId(id)}
     const result = await vehiclescollection.findOne(query)
     res.send(result)
    })
    app.post('/vehicles', async(req, res)=>{
      const newVehicle= req.body
      const result = await vehiclescollection.insertOne(newVehicle)
      res.send(result)
    })
    app.delete('/vehicles/:id', async(req, res)=>{
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const result = await vehiclescollection.deleteOne(query)
      res.send(result)
    })
    app.put('/vehicles/:id', async(req, res)=>{
      const updateVehicles = req.body
      const id = req.params.id
      const query = {_id: new ObjectId(id)}
      const updatedata={
        $set: updateVehicles
      }
      const result = await vehiclescollection.updateOne(query, updatedata)
      res.send(result)
    })
  } finally {
   
  }
}
run().catch(console.dir);

app.listen(port, ()=>{
    console.log('server connected', port);
    
})