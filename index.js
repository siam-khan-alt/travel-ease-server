const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config()
console.log(process.env); 

const app = express()
const port = process.env.PORT || 3000
app.use(cors())
app.use(express.json())
// const uri = "mongodb+srv://traveleasedb:YpZBFWWUSSO8y0nn@cluster0sp.xsshgji.mongodb.net/?appName=Cluster0SP";

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
  } finally {
   
  }
}
run().catch(console.dir);

app.listen(port, ()=>{
    console.log('server connected', port);
    
})