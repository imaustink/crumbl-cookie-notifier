'use strict';

const { createHash } = require('crypto');

const axios = require("axios");
const cheerio = require('cheerio');

const { getDefaultRoleAssumerWithWebIdentity } = require("@aws-sdk/client-sts");
const { defaultProvider } = require("@aws-sdk/credential-provider-node");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { DynamoDB } = require("@aws-sdk/client-dynamodb");
const { SNS } = require("@aws-sdk/client-sns");

const { TARGET_URL, PHONE_NUMBERS, COOKIES_TABLE_NAME, AWS_DYNAMO_ENDPOINT } = process.env;

const credentialProvider = defaultProvider({
  roleAssumerWithWebIdentity: getDefaultRoleAssumerWithWebIdentity,
});

const sns = new SNS({
  credentialDefaultProvider: credentialProvider
});

const dynamoClient = DynamoDBDocument.from(new DynamoDB({
  credentialDefaultProvider: credentialProvider,
  ...(AWS_DYNAMO_ENDPOINT && { endpoint: AWS_DYNAMO_ENDPOINT })
}));

module.exports.run = async () => {
  console.log("Fetching page", TARGET_URL);
  const { data: page } = await axios.get(TARGET_URL, {
    headers: { "Accept-Encoding": "gzip,deflate,compress" }
  });
  console.log("Page length", page.length)

  const c = cheerio.load(page);
  const cookieTitleElements = c("#weekly-cookie-flavors > li > div > h3");
  const cookieNames = Array.prototype.map.call(cookieTitleElements, (cookieTitle) => c(cookieTitle).text().trim());
  console.log("Cookie names", cookieNames);

  const cookieHash = createHash('sha256');
  cookieHash.update(cookieNames.join(""));
  const id = cookieHash.digest('hex')
  console.log("Cookie hash", id);

  const previousCookies = await dynamoClient.get({
    TableName: COOKIES_TABLE_NAME,
    Key: {
      id
    }
  })

  console.log("Previous cookies", previousCookies.Item)

  if (!previousCookies.Item) {
    const promises = PHONE_NUMBERS.split(",").map(async (phoneNumber) => {
      const sendMessageParams = {
        Message: `This week's Crumbl flavors just dropped! Check em out:\n\n${cookieNames.join("\n")}`,
        PhoneNumber: phoneNumber
      };
      console.log("Sending message params", sendMessageParams);
      await sns.publish(sendMessageParams);
    })

    await Promise.all(promises);

    const createRecordParams = {
      TableName: COOKIES_TABLE_NAME,
      Item: {
        id,
        cookiesNames: cookieNames
      }
    }
    console.log("Creating record params", createRecordParams)
    await dynamoClient.put(createRecordParams);
  }
};
