var graph    = require("../index")
  , FBConfig = require("./config").facebook
  , FireConfig = require("./config").fbase;

var async = require('async');
var firebase = require('firebase');
// cron variable to schedule the data fetch and inserting to firebase:
// time interval :- 1 min for testing purposes
var CronJob = require('cron').CronJob; 

firebase.initializeApp({
serviceAccount: {
    projectId:   FireConfig.projectId,
    clientEmail: FireConfig.clientEmail,
    privateKey:  FireConfig.privateKey
  },
  databaseURL: FireConfig.kDBBaseRef
});

var db = firebase.database();


graph.setAppSecret(FBConfig.appSecret)
graph.setAccessToken(FBConfig.accessToken)
graph.setVersion("2.6");

var postResults = [];
var userResults = [];
var postDict = {};
var imageDict = {};
var userArray = [];

var postKeys = ["uId", "pName","pMessage", "pUrl", "pUpdatedTime", "pCreatedTime", "pPrice", "pLocation", "pImages", "pImgDef","lastBidder","lastAmount","bids", "pOrder"];
var userKeys = ["uId", "uName", "uPost", "uImg"];
var imageKeys = ["iUrl", "submittedBy", "pId"];

var currentTime = Math.floor(Date.now() / 1000);

function getFBData(){

   async.waterfall([
    function(callback){
    	graph.get(FBConfig.groupUrl, function(err, res) {
    			if(err != null){
    				saveLogs(FireConfig.kDBLogRef,createLog(err));
    			}
  				callback(null, res.data);
		});
    },
    function(arg1, callback){
    	var userIds = [];
    	var str = "";
        arg1.forEach(function(value){
  				userIds.push(value.from.id);
  				str += "," + value.from.id;
		});
		str = str.substring(1,str.length);
		var url = "picture?ids=" +str+ "&redirect=false&type=large";
		graph.get(url, function(err, res) {
			if(err != null){
    			saveLogs(FireConfig.kDBLogRef,createLog(err));
    		}
			var results = [];
			results.push(arg1);
			results.push(res);
			callback(null,results);
		});
    }
  ], function (err, result) {
  		if(err != null){
    		saveLogs(FireConfig.kDBLogRef,createLog(err));
    	}
		saveData(result);
  });
}

function createLog(msg){
	var startTime = firebase.database.ServerValue.TIMESTAMP;
	log = {};
	log['msg'] = msg;
	log['time'] = startTime;
	return log;
}

function saveData(result){
	postResults = result[0];
	userResults = result[1];
	postResults.forEach(function(json){
		var post = {};
		var postValue = [];

		var pId = json.id;
// 		var pName = json.name;
		var pUrl = json.link;
		var pMessage = json.message;
		var pCreatedTime = Date.parse(json.created_time)/1000;
		var pUpdatedTime = Date.parse(json.updated_time)/1000;
		var priceAndLoc = getPriceAndLocAndName(pMessage);
		var pPrice = priceAndLoc[1];
		var pLoc = priceAndLoc[2];
		var pName = priceAndLoc[0];
		var uId = json.from.id;
		var uName = json.from.name;

		var imgIdAndSrcArray = getImageIdAndUrl(json);
		var imgSrcArray = imgIdAndSrcArray[1];
		var pImages = {};
		imgIdAndSrcArray[0].forEach(function (imgId){
			pImages[imgId] = true;
		});
		var users = {};
		var userValues = [];
		userValues.push(uId);
		userValues.push(uName);
		userValues.push(pId);
		userValues.push(userResults[uId].data.url);
		for(var i=0; i<userKeys.length;i++){
			users[userKeys[i]] = userValues[i];
		}
		postValue.push(users);
		postValue.push(pName);
		postValue.push(pMessage);
		postValue.push(pUrl);
		postValue.push(pUpdatedTime);
		postValue.push(pCreatedTime);
		postValue.push(pPrice);
		postValue.push(pLoc);
		postValue.push(pImages);
    	postValue.push(typeof imgSrcArray[0] == 'undefined'? '':imgSrcArray[0]);
    	postValue.push("");
    	postValue.push("");
    	postValue.push(null);

		postValue.push(currentTime-pCreatedTime);
		for(var i=0; i<postKeys.length;i++){
			if(typeof postValue[i] == 'undefined'){
				post[postKeys[i]] = '';
			}
			else{
				post[postKeys[i]] = postValue[i];
			}
		}
		postDict[pId] = post;

		// creating user records
		/*var users = {};
		var userValues = [];
		userValues.push(uId);
		userValues.push(uName);
		userValues.push(pId);
		userValues.push(userResults[uId].data.url);
		for(var i=0; i<userKeys.length;i++){
			users[userKeys[i]] = userValues[i];
		}
		userArray.push(users);
		*/
		// creating image record
// 		for(var i=0; i<imgIdAndSrcArray[0].length;i++){

		var c = 0;
		imgIdAndSrcArray[0].forEach(function (imgId){
			var image = {};
			var imageValue = [];
// 			imageValue.push(imgId);
			imageValue.push(imgSrcArray[c]);
			imageValue.push(uId);
			imageValue.push(pId);
			for(var i=0; i<imageKeys.length;i++){
				image[imageKeys[i]] = imageValue[i];
			}
			c = c+1;
			imageDict[imgId] = image;
		});

	});

	// saving data to firebase

	async.series
    ([
        function (callback)
        {
        	saveToDatabaseWithRef(FireConfig.kDBPostRef,postDict);
            callback();
        }
        ,
        function (callback)
        {
        	saveToDatabaseWithRef(FireConfig.kDBImageRef,imageDict);
            callback();
        }
       /* ,
        function (callback)
        {
        	saveUserAndImages(FireConfig.kDBImageRef,imageArray);
            callback();
        }*/
    ]
    ,
    function(err)
    {
    	if(err != null){
    		saveLogs(FireConfig.kDBLogRef,createLog(err));
    	}
		saveLogs(FireConfig.kDBLogRef,createLog('saving data'));
        console.log("Done !");
    });
}

function getPriceAndLocAndName(msg){
	var price = 0;
	var loc = "";
	var name = "";
	if(typeof msg != 'undefined'){
		var msgArray = msg.split("\n");
		name = msgArray[0];
		if(msgArray.length>2){
			var priceAndLocArray = msgArray[1].split("-");
			if(priceAndLocArray.length>1){
				if(priceAndLocArray[0].trim().toUpperCase()=="FREE"){
					price = -1;
				}
				else if(priceAndLocArray[0].trim().length >0){
					var str = priceAndLocArray[0].trim();
					var p = str.replace( /^\D+/g, '');
					price = parseInt(p.match(/\d+/)==null?0:p.match(/\d+/)[0])
				}
				if(priceAndLocArray[1].length>0){
					loc = priceAndLocArray[1].trim();
				}
			}
		}
	}
	return [name, price, loc];
}

function getImageIdAndUrl(post){
	var imgSrcArray = [];
	var imgIdArray = [];
	if(typeof post.attachments!= 'undefined'){
		if(typeof post.attachments.data[0].subattachments != 'undefined'){
			var submedia = post.attachments.data[0].subattachments.data;
			submedia.forEach(function(img){
				imgSrcArray.push(img.media.image.src);
				imgIdArray.push(img.target.id);
			});
			return [imgIdArray, imgSrcArray];
		}
		else if(typeof post.attachments != 'undefined'){
			if( typeof post.attachments.data[0].media != 'undefined'){
				var postData = post.attachments.data[0];
					imgSrcArray.push(postData.media.image.src);
					imgIdArray.push(postData.target.id);
				if(typeof imgIdArray[0] == 'undefined'){
					imgIdArray[0] = new Date().getTime();
				}
			}
			return [imgIdArray, imgSrcArray];
		}
	}
	return [imgIdArray, imgSrcArray];
}

var onComplete = function(error) {
  if (error) {
    if(error != null){
    		saveLogs(FireConfig.kDBLogRef,createLog(error));
    	}
  } else {
    console.log('Synchronization succeeded');
    process.exit();
  }
};
function saveToDatabaseWithRef(childRef, data){
	var postRef = db.ref(childRef);
	postRef.update(data);
// 	postRef.update(data,onComplete);

}

function saveLogs(childRef, data){
	var postRef = db.ref(childRef);
// 	data.forEach(function (value){
		postRef.push().set(data);
// 	});
// 	postRef.push().update(data,onComplete);
}


// reading data from database
function readDataFromChild(childRef){
	var ref = db.ref(childRef);
	ref.on("value", function(snapshot) {
  		console.log(snapshot.val());
	}, function (errorObject) {
  	console.log("The read failed: " + errorObject.code);
	});
}

//getFBData();

// call cron function and fetch the data every 1 minute
/*
5 * * * * *' - runs every 5 seconds
'10,20,30 * * * * *' - run at 10th, 20th and 30th second of every minute
'0 * * * * *' - runs every minute
'0 0 * * * *' - runs every hour (at 0 minutes and 0 seconds)
*/

var job = new CronJob('2 * * * * *', function() {
  /*
   * Runs every two minutes
   */
   getFBData();
  }, function () {
    /* This function is executed when the job stops */
    saveLogs(FireConfig.kDBLogRef,"An internal error has occured.");
    
  },
  true /* Start the job right now */
  //timeZone /* Time zone of this job. */
);
// readDataFromChild(FireConfig.kDBImageRef);
