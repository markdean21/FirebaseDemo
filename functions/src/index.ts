import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin'

//const gcs = require('@google-cloud/storage')()
//const spawn = require('child-process-promise').spawn

//import { request } from 'http';
//import { error } from 'util';

const mkdirp = require('mkdirp-promise');

admin.initializeApp();

const spawn = require('child-process-promise').spawn;
const path = require('path');
const os = require('os');
const fs = require('fs');

// Max height and width of the thumbnail in pixels.
const THUMB_MAX_HEIGHT = 200;
const THUMB_MAX_WIDTH = 200;
// Thumbnail prefix added to file names.
const THUMB_PREFIX = 'thumb_';

const ref = admin.database().ref()
const firestore = admin.firestore()


exports.generateThumbnail = functions.storage.object().onFinalize(async (object) =>{
  // File and directory paths.
  const filePath = object.name;
  const contentType = object.contentType; // This is the image MIME type
  const fileDir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const thumbFilePath = path.normalize(path.join(fileDir, `${THUMB_PREFIX}${fileName}`));
  const tempLocalFile = path.join(os.tmpdir(), filePath);
  const tempLocalDir = path.dirname(tempLocalFile);
  const tempLocalThumbFile = path.join(os.tmpdir(), thumbFilePath);

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
  await bucket.upload(tempLocalThumbFile, {destination: thumbFilePath, metadata: metadata});
  console.log('Thumbnail uploaded to Storage at', thumbFilePath);
  // Once the image has been uploaded delete the local files to free up disk space.
  fs.unlinkSync(tempLocalFile);
  fs.unlinkSync(tempLocalThumbFile);
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
