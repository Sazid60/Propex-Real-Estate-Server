const express = require('express')
const app = express()
const cors = require('cors')
const jwt = require('jsonwebtoken')
require('dotenv').config()

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 5000

// Middleware
app.use(cors())
app.use(express.json())


const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.cjbmdks.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const usersCollection = client.db("Propex").collection("users")
        const propertyCollection = client.db("Propex").collection("properties")
        const reviewCollection = client.db("Propex").collection("reviews")
        const wishlistCollection = client.db("Propex").collection("wishlist")
        const offeringCollection = client.db("Propex").collection("offerings")
        const paymentsCollection = client.db("Propex").collection("payments")


        // jwt related API
        app.post('/jwt', async (req, res) => {
            const user = req.body
            // console.log(user)
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '365d'
            })
            res.send({ token })
        })



        // middlewares 
        const verifyToken = (req, res, next) => {
            // console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access' });
            }
            const token = req.headers.authorization.split(' ')[1];
            // console.log(token)
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    console.log(err)
                    return res.status(401).send({ message: 'unauthorized access' })

                }
                req.decoded = decoded;
                next();
            })
        }

        // verify Admin
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'admin';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // verify agent
        const verifyAgent = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            const isAdmin = user?.role === 'agent';
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // create-payment-intent
        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            const price = req.body.price
            const priceInCent = parseFloat(price) * 100
            if (!price || priceInCent < 1) return
            // generate clientSecret
            const { client_secret } = await stripe.paymentIntents.create({
                amount: priceInCent,
                currency: 'usd',
                automatic_payment_methods: {
                    enabled: true,
                },
            })
            // send client secret as response
            res.send({ clientSecret: client_secret })
        })

        // Get All users
        app.get('/users', verifyToken, verifyAdmin, async (req, res) => {

            const result = await usersCollection.find().toArray();
            res.send(result)
        })

        // Find User Role
        app.get('/user/:email', async (req, res) => {
            const email = req.params.email
            const result = await usersCollection.findOne({ email })
            res.send(result)
        })

        // saving user in database
        app.post('/user', async (req, res) => {
            const user = req.body;
            const query = { email: user.email }
            const existingUser = await usersCollection.findOne(query);

            if (existingUser) {
                return res.send({ message: 'User Exist', insertedId: null })
            }
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        // delete a user 
        app.delete('/user/:id', verifyToken, verifyAdmin, async (req, res) => {
            {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = usersCollection.deleteOne(query)
                res.send(result)
            }
        })

        // update role to admin
        app.patch('/users/admin/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const { role } = req.body;
            console.log(role)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { role: role },
            }
            const result = await usersCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // update role to agent
        app.patch('/users/agent/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const { role } = req.body;
            // console.log(role)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { role: role },
            }
            const result = await usersCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // mark as fraud
        app.patch('/users/fraud/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const { status, email } = req.body;

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status: status },
            }
            const result = await usersCollection.updateOne(query, updateDoc)

            // delete all property added by the user
            const deleteResult = await propertyCollection.deleteMany({ agentEmail: email })
            // TODO: delete from Offered Collection and Wishlist
            // const deletedOffered = await offeringCollection.deleteMany({ agentEmail: email })
            const deletedWishlist = await wishlistCollection.deleteMany({ agentEmail: email })
            res.send(result)
        })

        // find a fraud
        app.get('/user/fraudCheck/:email', async (req, res) => {
            const email = req.params.email;
            const fraudUser = await usersCollection.findOne({ email });
            res.send(fraudUser)
        })

        // Add a Property
        app.post('/property', verifyToken, verifyAgent, async (req, res) => {
            const propertyInfo = req.body;
            const result = await propertyCollection.insertOne(propertyInfo)
            res.send(result)
        })

        // get all the properties
        app.get('/properties', verifyToken, async (req, res) => {
            const search = req.query.search
            let query = {}
            if (search) {
                query = { title: { $regex: search, $options: 'i' } }
            }
            const result = await propertyCollection.find(query).toArray()
            res.send(result)
        })

        // get all the properties
        app.get('/advertisedProperties', async (req, res) => {
            const result = await propertyCollection.find().toArray()
            res.send(result)
        })

        // get all user specific properties
        app.get('/properties/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const query = { agentEmail: email }
            const result = await propertyCollection.find(query).toArray()
            res.send(result)
        })

        // get a property
        app.get('/single-property/:id', verifyToken, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const query = { _id: new ObjectId(id) }
            const result = await propertyCollection.findOne(query)
            res.send(result)
        })

        // delete a property
        app.delete('/properties/:id', verifyToken, verifyAgent, async (req, res) => {
            {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = propertyCollection.deleteOne(query)
                res.send(result)
            }
        })

        // update a property
        app.put('/property/update/:id', verifyToken, verifyAgent, async (req, res) => {
            const id = req.params.id
            const propertyData = req.body
            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: propertyData,
            }
            const result = await propertyCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // verify property verify status
        app.patch('/property/verify/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const { verification_status } = req.body;
            // console.log(verification_status)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { verification_status: verification_status },
            }
            const result = await propertyCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // advertise a property
        app.patch('/property/advertise/:id', verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id
            // console.log(id)
            const { advertised } = req.body;
            // console.log(advertised)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { advertised: advertised },
            }
            const result = await propertyCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // add a review
        app.post('/review', verifyToken, async (req, res) => {
            const reviewDetails = req.body
            const result = await reviewCollection.insertOne(reviewDetails)
            res.send(result)
        })

        // get property specific reviews
        app.get('/reviews/:propertyId', async (req, res) => {
            const propertyId = req.params.propertyId;
            const query = { reviewedPropertyId: propertyId }
            const result = await reviewCollection.find(query).toArray()
            res.send(result)
        })

        // Get All The Reviews
        app.get('/reviews', async (req, res) => {
            const result = await reviewCollection.find().toArray()
            res.send(result)
        })

        // get User Specific reviews
        app.get('/userReview/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            // console.log(email)
            const query = { reviewerEmail: email }
            const result = await reviewCollection.find(query).toArray()
            res.send(result)
        })

        // delete a review
        app.delete('/review/:id', verifyToken, async (req, res) => {
            {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = await reviewCollection.deleteOne(query)
                res.send(result)
            }
        })

        // all to wishlist
        app.post('/wishlist-property', verifyToken, async (req, res) => {
            const wished_property = req.body;
            const result = await wishlistCollection.insertOne(wished_property)
            res.send(result)
        })

        // get user specific wishlist
        app.get('/wishes', verifyToken, async (req, res) => {
            const email = req.query.email
            // console.log(email)
            const query = { wisherEmail: email }
            const result = await wishlistCollection.find(query).toArray()
            res.send(result)
        })

        // get specific user Id 
        app.get('/wishes/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await wishlistCollection.findOne(query)
            res.send(result)
        })

        // delete a property from wishlist
        app.delete('/wishes/:id', verifyToken, async (req, res) => {
            {
                const id = req.params.id
                const query = { _id: new ObjectId(id) }
                const result = await wishlistCollection.deleteOne(query)
                res.send(result)
            }
        })

        // add a property to offered list
        app.post('/offerings', verifyToken, async (req, res) => {
            const offeredInfo = req.body
            const result = await offeringCollection.insertOne(offeredInfo)
            const wishId = offeredInfo.wishId;
            const query = { _id: new ObjectId(wishId) }
            const deletedResult = await wishlistCollection.deleteOne(query)
            // console.log(wishId)
            res.send(result)
        })

        // get user specific offered property
        app.get('/offerings/:email', verifyToken, async (req, res) => {
            const buyerEmail = req.params.email
            const query = { buyerEmail: buyerEmail }
            const result = await offeringCollection.find(query).toArray()
            res.send(result)
        })

        // get all oferings
        app.get('/getOfferings', verifyToken, verifyAgent, async (req, res) => {
            const agentEmail = req.query.agentEmail;
            const query = { agentEmail: agentEmail }
            // console.log(agentEmail)
            const result = await offeringCollection.find(query).toArray()
            // console.log(result)
            res.send(result)
        })

        // update a rejected status of a offering
        app.patch('/rejectOffering/:id', verifyToken, verifyAgent, async (req, res) => {
            const id = req.params.id;

            const { status } = req.body;
            // console.log(status)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status: status },
            }
            const result = await offeringCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // Accept Offering
        app.patch('/acceptOffering', verifyToken, verifyAgent, async (req, res) => {
            const { id, status, propertyId } = req.body;
            // console.log(propertyId)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: { status: status },
            }
            const result = await offeringCollection.updateOne(query, updateDoc)

            // reject all the offers for the property

            const rejectQuery = { propertyId: propertyId, _id: { $ne: new ObjectId(id) } };
            const rejectDoc = {
                $set: { status: 'rejected' }, // Set their status to "rejected"
            };
            const rejectResult = await offeringCollection.updateMany(rejectQuery, rejectDoc);

            res.send(result)
        })

        // get Property for payment
        app.get('/buyingProperty/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await offeringCollection.findOne(query)
            res.send(result)
        })

        // Save in payment db
        app.post('/soldProperties', verifyToken, async (req, res) => {
            const paymentInfo = req.body;
            const result = await paymentsCollection.insertOne(paymentInfo)
            res.send(result)
        })
        //  set status after payment of offering collection
        app.patch('/after-payment-status', verifyToken, async (req, res) => {
            const { status, id, transactionId } = req.body;

            // console.log(status)

            const query = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    status: status,
                    transactionId: transactionId,
                },
            }
            const result = await offeringCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // updaate property selling status after payment

        // update a rejected status of a offering
        app.patch('/update-selling-status/:propertyId', verifyToken, async (req, res) => {
            const propertyId = req.params.propertyId;

            const { selling_status } = req.body;
            console.log(selling_status)

            const query = { _id: new ObjectId(propertyId) }
            const updateDoc = {
                $set: { selling_status: selling_status },
            }
            const result = await propertyCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        // get agent specific sold properties
        app.get('/my-sold-properties', verifyToken, verifyAgent, async (req, res) => {
            const agentEmail = req.query.agentEmail;
            const query = { agentEmail: agentEmail }
            const result = await paymentsCollection.find(query).toArray()
            res.send(result)
        })

        // agent statistics
        app.get('/agent-statistics', verifyToken, verifyAgent, async (req, res) => {
            const agentEmail = req.query.agentEmail

            const propertySold = await paymentsCollection.find(
                { agentEmail: agentEmail },
                { projection: { offerPrice: 1 } }
            ).toArray()

            const totalProperties = await propertyCollection.countDocuments({ agentEmail: agentEmail })

            const totalPrice = propertySold.reduce((sum, payment) => sum + payment.offerPrice, 0)

            res.send({
                soldProperties: propertySold.length,
                totalPrice,
                totalProperties
            })
        })



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);



app.get('/', async (req, res) => {
    res.send('Propex is Running')
})

app.listen(port, () => {
    console.log(`Propex On port ${port}`)
})