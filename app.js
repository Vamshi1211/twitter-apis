const express = require("express");
const app = express();
app.use(express.json());

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

let db;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => console.log("Server is running"));
  } catch (err) {
    console.log(`DB Error: ${err.message}`);
  }
};

initializeDBAndServer();

const convertTweetIntoCamelCase = (everyTweetObject) => {
  return {
    username: everyTweetObject.username,
    tweet: everyTweetObject.tweet,
    dateTime: everyTweetObject.date_time,
  };
};

//Register the User API
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  const checkUserInDBQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const checkUserInDB = await db.get(checkUserInDBQuery);

  if (checkUserInDB !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const addUserQuery = `INSERT INTO user(name, username, password, gender) 
                                    VALUES(
                                        '${name}',
                                        '${username}',
                                        '${hashedPassword}',
                                        '${gender}'
                                    );`;
      const addUserInDB = await db.run(addUserQuery);
      const newUserId = addUserInDB.lastID;
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//Authenticate Token API
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authenticateHeader = request.headers["authorization"];
  if (authenticateHeader !== undefined) {
    jwtToken = authenticateHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user_id = payload.user_id;
        next();
      }
    });
  }
};

//Login the USER API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserInDBQuery = `SELECT * FROM user WHERE username = '${username}';`;

  const checkUserInDb = await db.get(checkUserInDBQuery);

  if (checkUserInDb === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      checkUserInDb.password
    );
    if (isPasswordMatched === true) {
      const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}';`;
      const getUserId = await db.get(getUserIdQuery);
      const userId = getUserId.user_id;
      const payload = { user_id: userId };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");

      response.send({ jwtToken });
      console.log(jwtToken);
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Returns the latest tweets of people whom the user follows. Return 4 tweets at a time

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const getTweetsOfaUserFollowsQuery = `SELECT * FROM follower INNER JOIN tweet 
                                            ON follower.following_user_id = tweet.user_id
                                            INNER JOIN user ON user.user_id = tweet.user_id
                                            WHERE follower_user_id = ${userId}
                                            ORDER BY date_time DESC
                                            LIMIT 4;`;
  const getDataFromDB = await db.all(getTweetsOfaUserFollowsQuery);

  const getTweetInCamelCase = getDataFromDB.map((everyTweet) => {
    return convertTweetIntoCamelCase(everyTweet);
  });
  response.send(getTweetInCamelCase);
});

//Returns the list of all names of people whom the user follows

app.get("/user/following/", authenticateToken, async (request, response) => {
  const userId = request.user_id;
  const getUserFollowingsQuery = `SELECT DISTINCT(user.name) FROM follower INNER JOIN tweet
                                    ON follower.following_user_id = tweet.user_id
                                    INNER JOIN user ON user.user_id = tweet.user_id
                                    WHERE follower.follower_user_id = ${userId};`;

  const getUserFollowingFromDB = await db.all(getUserFollowingsQuery);
  response.send(getUserFollowingFromDB);
});

//Returns the list of all names of people who follows the user

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const getUsersFollowersQuery = `SELECT user.name FROM follower INNER JOIN user ON follower.following_user_id = ${userId}
                                    WHERE user.user_id = follower.follower_user_id;`;
  const getFollowersFromDB = await db.all(getUsersFollowersQuery);

  response.send(getFollowersFromDB);
});

app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const userId = request.user_id;
  const { tweetId } = request.params;

  const getUserFollowingsQuery = `SELECT * FROM follower INNER JOIN user ON follower.follower_user_id = ${userId}
                                    INNER JOIN tweet ON tweet.user_id = follower.following_user_id
                                    WHERE user.user_id = follower.following_user_id;`;
  const getUserFollowingFromDB = await db.all(getUserFollowingsQuery);

  const getTweetIdArray = getUserFollowingFromDB.map((everyTweet) => {
    return everyTweet.tweet_id;
  });

  const verifyId = getTweetIdArray.includes(parseInt(tweetId));

  if (verifyId) {
    const getLikesAndRepliesQuery = `SELECT  DISTINCT(tweet.tweet),
                                        COUNT(DISTINCT( like.like_id)) AS likes,
                                        COUNT(DISTINCT(reply.reply_id)) AS replies,
                                       tweet.date_time AS dateTime
                                        FROM like INNER JOIN reply 
                                        ON like.tweet_id = reply.tweet_id 
                                        INNER JOIN tweet ON tweet.tweet_id = ${tweetId}
                                        WHERE  like.tweet_id = ${tweetId} 
                                        AND reply.tweet_id = ${tweetId};`;
    const getLikesAndRepliesDB = await db.all(getLikesAndRepliesQuery);
    response.send(getLikesAndRepliesDB[0]);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const userId = request.user_id;
    const { tweetId } = request.params;

    const getUserFollowingsQuery = `SELECT * FROM follower INNER JOIN user ON follower.follower_user_id = ${userId}
                                    INNER JOIN tweet ON tweet.user_id = follower.following_user_id
                                    WHERE user.user_id = follower.following_user_id;`;
    const getUserFollowingFromDB = await db.all(getUserFollowingsQuery);

    const getTweetIdArray = getUserFollowingFromDB.map((everyTweet) => {
      return everyTweet.tweet_id;
    });

    const verifyId = getTweetIdArray.includes(parseInt(tweetId));
    if (verifyId) {
      const getLikedUserNameQuery = `SELECT user.username FROM like INNER JOIN user
                                        ON like.user_id = user.user_id
                                    WHERE like.tweet_id = ${tweetId};`;
      const getLikedUserName = await db.all(getLikedUserNameQuery);
      const getArray = getLikedUserName.map((eachUser) => {
        return eachUser.username;
      });
      response.send({ likes: getArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const userId = request.user_id;
    const { tweetId } = request.params;

    const getUserFollowingsQuery = `SELECT * FROM follower INNER JOIN user ON follower.follower_user_id = ${userId}
                                    INNER JOIN tweet ON tweet.user_id = follower.following_user_id
                                    WHERE user.user_id = follower.following_user_id;`;
    const getUserFollowingFromDB = await db.all(getUserFollowingsQuery);

    const getTweetIdArray = getUserFollowingFromDB.map((everyTweet) => {
      return everyTweet.tweet_id;
    });

    const verifyId = getTweetIdArray.includes(parseInt(tweetId));
    if (verifyId) {
      const getLikedUserNameQuery = `SELECT user.name, reply.reply FROM reply INNER JOIN user
                                        ON reply.user_id = user.user_id
                                    WHERE reply.tweet_id = ${tweetId};`;
      const getLikedUserName = await db.all(getLikedUserNameQuery);

      const getArray = getLikedUserName.map((eachUser) => {
        return eachUser;
      });
      response.send({ replies: getArray });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const userId = request.user_id;

  const getUserTweetsQuery = `SELECT * FROM tweet WHERE tweet.user_id = ${userId};`;

  const getUserTweets = await db.all(getUserTweetsQuery);

  response.send(getUserTweets);
});

app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const userId = request.user_id;
  const { tweet } = request.body;

  const addTweetQuery = `INSERT INTO tweet(tweet, user_id) 
                             VALUES(
                                 '${tweet}',
                                 ${userId}
                             );`;
  const addTweetToDB = await db.run(addTweetQuery);

  response.send("Created a Tweet");
});

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const userId = request.user_id;
    const { tweetId } = request.params;

    const getTweetsQuery = `SELECT * FROM tweet WHERE user_id = ${userId};`;

    const getTweetsFromDB = await db.all(getTweetsQuery);

    const getTweetId = getTweetsFromDB.map((eachTweet) => {
      return eachTweet.tweet_id;
    });

    const checkTweetId = getTweetId.includes(parseInt(tweetId));

    if (checkTweetId) {
      const deleteQuery = `DELETE FROM tweet WHERE tweet_id = ${tweetId};`;

      const deleteTweetFromDB = await db.run(deleteQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
