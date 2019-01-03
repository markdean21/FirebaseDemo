import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin'
import { user } from 'firebase-functions/lib/providers/auth';
import { userInfo } from 'os';

//const gcs = require('@google-cloud/storage')()
//const spawn = require('child-process-promise').spawn

//import { request } from 'http';
//import { error } from 'util';



admin.initializeApp();
const ref = admin.database().ref()

const mkdirp = require('mkdirp-promise');
const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');

// Max height and width of the thumbnail in pixels.
const THUMB_MAX_HEIGHT = 200;
const THUMB_MAX_WIDTH = 200;
// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';

const firestore = admin.firestore()


exports.generateThumbnail = functions.storage.object().onFinalize(async (object) =>{
  // File and directory paths.
  const owner = object.metadata.uid;
  const filePath = object.name;
  const contentType = object.contentType; // This is the image MIME type
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const nameWithoutExt = path.basename(fileName, '.jpg');
  const thumbFilePath = path.normalize(path.join(fileDir, `${THUMB_PREFIX}${fileName}`));
  const thumbFileSaved = path.normalize(path.join(fileDir+'/'+nameWithoutExt+'/thumb/', `${THUMB_PREFIX}${fileName}`));
  const FileSaved = path.normalize(path.join(fileDir+'/'+nameWithoutExt, `${fileName}`));
  const tempLocalFile = path.join(os.tmpdir(), filePath);
  const tempLocalDir = path.dirname(tempLocalFile);
  const tempLocalThumbFile = path.join(os.tmpdir(), thumbFilePath);
  
  console.log('Owner: '+owner);
  console.log('filepath: '+filePath);
  console.log('content type: '+contentType);
  console.log('file Dir: '+fileDir);
  console.log('file Name:'+fileName);
  console.log('file saved:'+FileSaved);
  console.log('thumbnail path: '+thumbFilePath);
  console.log('tempLocalFile: '+ tempLocalFile);
  console.log('templocalDir:'+tempLocalDir);
  console.log('templocalthumbfile:'+tempLocalThumbFile);
  

  // Exit if this is triggered on a file that is not an image.
  if (!contentType.startsWith('image/')) {
     console.log('This is not an image.');
     return;
  }

  // Exit if the image is already a thumbnail.
  if (fileName.startsWith(THUMB_PREFIX)) {
    console.log('Already a Thumbnail.');
    return;
  }



   // Cloud Storage files.
   const bucket = admin.storage().bucket(object.bucket);
   const file = bucket.file(filePath);
   const thumbFile = bucket.file(thumbFilePath);
   const metadata = {
     contentType: contentType,
     // To enable Client-side caching you can set the Cache-Control headers here. Uncomment below.
     // 'Cache-Control': 'public,max-age=3600',
   };

    // Create the temp directory where the storage file will be downloaded.
  await mkdirp(tempLocalDir)
  // Download file from bucket.
  await file.download({destination: tempLocalFile});
 
  console.log('The file has been downloaded to', tempLocalFile);
  // Generate a thumbnail using ImageMagick.
  await spawn('convert', [tempLocalFile, '-thumbnail', `${THUMB_MAX_WIDTH}x${THUMB_MAX_HEIGHT}>`, tempLocalThumbFile], {capture: ['stdout', 'stderr']});
  console.log('Thumbnail created at', tempLocalThumbFile);
  // Uploading the Thumbnail.
  // users/{uid}/thumb
  await bucket.upload(tempLocalThumbFile, {destination: thumbFileSaved, metadata: metadata});
  console.log('Thumbnail uploaded to Storage at', thumbFileSaved);
  //Uploading the original image to User folder users/{uid}
   await bucket.upload(tempLocalFile, {destination: FileSaved, metadata: metadata})
  // Once the image has been uploaded delete the local files to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(tempLocalThumbFile);
  //TODO: delete the file uploaded in users/ folder
  //TODO: update the thumbUrl and photoUrl in users/{userid}
  
  // Get the Signed URLs for the thumbnail and original image.
  const config = {
    action: 'read',
    expires: '03-01-2500',
  };

  const results = await Promise.all([
    thumbFile.getSignedUrl(config),
    file.getSignedUrl(config),
  ]);
  console.log('Got Signed URLs.');
  const thumbResult = results[0];
  const originalResult = results[1];
  const thumbFileUrl = thumbResult[0];
  const fileUrl = originalResult[0];
  // Add the URLs to the Database
  await admin.database().ref('images').push({path: fileUrl, thumbnail: thumbFileUrl});
  console.log('Thumbnail URLs saved to database.'); 



  return;

}) 



exports.createUserAccount = functions.auth.user().onCreate(event =>{
    const uid  = event.uid
    const email = event.email
    const photoUrl = event.photoURL || 'https://vignette.wikia.nocookie.net/animal-jam-clans-1/images/f/f9/Cinderfur242.jpg'
    const newUserRef = ref.child('/users/'+uid)
    const name = event.displayName
    
    const constactNumber= event.phoneNumber

    const firestoreRef = firestore.doc('/users/'+uid)

    const p1 = newUserRef.set({
        photoURL:photoUrl,
        email:email,
        ref: uid
    })

    const p2 = firestoreRef.set({
        photoURL:photoUrl,
        email:email, 
        ref: uid, 
        name: name, 
        contactNumber: constactNumber, 
        skills: null, 
        givenName: null,
        middleName: null, 
        lastName : null, 
        address: null,
        description: null, 
        is_fixer: null 


    })

    return Promise.all([p1, p2])


})

//TODO: Create task function that would copy the created task to the master task, /task/{taskId}
exports.createTask = functions.firestore.document('/users/{userId}/task/{refObject}').onCreate(
    event =>{
    
    console.log('Task Master Creation Started');
    console.log('Data: '+ event.data());
    console.log('Task/Doc Id:'+ event.id); //Task reference

    const taskId = event.id;
    const taskData = event.data();
   
    const firestoreRef = firestore.doc('/tasks/'+taskId); //tasks master

    const p1 = firestoreRef.set(taskData); //copy the task details to the task master
    const p2 = firestoreRef.set({ref: taskId}, {merge:true}); // add the docId of the task created
    console.log('Task Master Creation Ended');
    return Promise.all([p1, p2]) 
    
    }
);

//TODO: Create Bid function
exports.createBid = functions.firestore.document('/bids/{bidId}').onCreate(
    async event => {

    const bidId = event.id; //Bid reference
    const bidData = event.data(); // bid details info
    const bidderRef = bidData.refBidder;
    const taskRef = bidData.refTask;
    const CreatorRef = bidData.refCreator;

    const promises = [];

   // console.log('Bidder :'+ bidData.refBidder);

    const firestoreUserRef = firestore.doc('/users/'+bidderRef+'/bids/'+bidId); //users bids (bidder)
    const firestoreTaskRef = firestore.doc('/tasks/'+taskRef+'/bids/'+bidId);    // bids for the task
    const firestoreCreatorRef = firestore.doc('/users/'+CreatorRef+'/bids/'+bidId); //bids for the task of the creator

    const p1 = firestoreUserRef.set(bidData); //copy bid details from master bids to bidders bids
    const p2 = firestoreTaskRef.set(bidData); //copy bid details from master bids to master task bids
    const p3 = firestoreCreatorRef.set(bidData); //copy bid details from master bids to task creator
    
    promises.push(p1);
    promises.push(p2);
    promises.push(p3);

    
   //put the task for each bidder
   try {
    const task = await firestore.doc('/tasks/'+taskRef).get();
    const taskData = task.data();
    console.log('Get the task data ref:'+taskRef);
    bidderRef.forEach(bidder => {
        const firestoreBidderRef = firestore.doc('/users/'+bidder+'/tasks/'+taskRef); //users bids (bidder)
        const p = firestoreBidderRef.set(taskData); //copy bid details from master bids to bidders bids
        console.log('Put the task data to bidder : '+bidder);
        promises.push(p);
    });

   } catch (error) {
       console.log(error);
   }
 

    return Promise.all(promises);

    /*        
    bidderRef.forEach(arr => {
        console.log('value: '+arr+' ');
        });

    return;
    */
    }
);



// Start writing Firebase Functions
// https://firebase.google.com/docs/functions/typescript
/*
export const onBostonWeatherUpdate = 
functions.firestore.document("cities-weather/boston-ma-us").onUpdate( change => {
    const after = change.after.data()
    const payload = {
        data:{
            temp:String(after.temp), 
            conditions: after.conditions
        }
    }
    return admin.messaging().sendToTopic("weeather_boston-ma-us", payload)
})

*/

export const getBostonAreaWeather =
functions.https.onRequest((request, response) => {
    admin.firestore().doc("areas/greater-boston").get()
    .then(areaSnapshot => {
        const cities = areaSnapshot.data().cities
       // response.send(cities)
        const promises = []
        cities.forEach(city => {
            const p = admin.firestore().doc('cities-weather/'+city+'').get()
            promises.push(p)
        });
       // for (const city in cities){
           // console.log('cities-weather/'+city)
           // const p = admin.firestore().doc('cities-weather/'+city+'').get()
          // promises.push(p)
       // }
     //   response.send(promises)
        return Promise.all(promises) 
    })
    .then(citySnapshots => {
        
        const results = []
        citySnapshots.forEach(citySnap =>{
            const data = citySnap.data()
            data.city = citySnap.id
            results.push(data)
        })
        response.send(results)
        
    })
    .catch(error =>{
        console.log(error);
        response.status(500).send(error)
    })
})



export const getBostonWeather = functions.https.onRequest((request, response) => {
    admin.firestore().doc('cities-weather/boston-ma-us').get()

    .then(snapshot => {
        const data = snapshot.data()
        response.send(data)
    })
    .catch(error => {
        console.log(error)
        response.status(500).send(error)
    })
  
  
    // console.log('Hello Marko');
   // response.send("Hello from Firebase by Mark Dean Raymundo!");
});
