const Imap = require('imap')
const {simpleParser} = require('mailparser')
const puppeteer = require('puppeteer')
const fs  = require('fs')
const path = require('path')
require('dotenv').config()

const imapConfig = {
  user: process.env.OUTLOOK_EMAIL,
  password: process.env.OUTLOOK_PWD,
  host: 'outlook.office365.com',
  port: 993,
  tls: true,
  markSeen: true,
  bodies:''
};

const messages = [
  "Cant you see that the account is inactive since January Just ask me question to verify its mine",
  "I just lost my MFA app wtf am I suppose to do, Do a verification test",
  "I wont stop resubmitting forms to get back my account, send me someone to confirm my identity",
  "Send me a message to verify my identity come on facebook, I HAVE MY PASSWORD",
  "I have my password my phone access to my mails I JUST LOST MFA APP FFS",
  "I can tell u its my birthday this saturday, and its not even public, how would i know if i was a scam"
]

let rejectEmailTimer
let verifCodeTimer

const rejectMessage = 'We can’t give you access to this account or help with your request until we receive an accepted form of ID that matches the information listed on the account'
const verifMessage = 'Use this code to verify your email address on Facebook'

const getEmails = async (from) => {
  return new Promise((resolve, reject) => {
    try {
      const imap = new Imap(imapConfig);
      imap.once('ready', () => {
        imap.openBox('INBOX', false, () => {
          imap.search(['UNSEEN', ['FROM', from]], (err, results) => {
            let f
            try {
              f = imap.fetch(results, {bodies: ''});
            } catch (error) {
              if(error.toString().includes('Nothing to fetch')) {
                console.log("No mail inbox \n")
                resolve(undefined)
              }
              else reject(error)
            }
            // console.log("F =", f)
            f?.on('message', msg => {
              msg.on('body', stream => {
                
                let buffer = '';
                stream.on('data', function (chunk) {
                    buffer += chunk.toString('utf8');
                });
                stream.once('end', function () {
                    // Mark the above mails as read
                    msg.once('attributes', function (attrs) {

                        let uid = attrs.uid;
                        imap.addFlags(uid, ['\\Seen'], function (err) {
                            if (err) {
                                console.log(err);
                            } else {
                                console.log("Marked as read!\n")
                            }
                        });

                    })
                })

                simpleParser(stream, async (err, parsed) => {
                  console.log("Got a mail\n")
                  if(from === 'security@facebookmail.com' && parsed.text.includes(verifMessage)){
                    console.log("Resolving get mail \n")
                    resolve(parsed.text)
                  }
                  if(from === 'noreply@support.facebook.com' && parsed.text.includes(rejectMessage)){
                    console.log("Resolving get mail \n")
                    resolve(parsed)
                  }
                });
              });
            });
            f?.once('error', ex => {
              console.log("Ex = ", ex)
              return Promise.reject(ex);
            });
            f?.once('end', () => {
              console.log('Done fetching all messages!\n');
              imap.end();
            });
          });
        });
      });
  
      imap.once('error', err => {
        console.log(err);
        reject()
      });
  
      imap.once('end', () => {
        console.log('Connection ended\n');
      });
  
      imap.connect();
    } catch (ex) {
      console.log('an error occurred\n');
    }
  })
};

const scrappe = async () => {
  return new Promise(async (resolve, reject) => {
    try{
      const browser = await puppeteer.launch({headless:false});
      const page = await browser.newPage();
      await page.goto('https://fr-fr.facebook.com/');

      const cookies = await page.$('[data-cookiebanner="accept_button"]')
      await cookies.evaluate( button => button.click() )

      const emailInput = await page.waitForSelector('[data-testid="royal_email"]')
      await emailInput.focus()
      await emailInput.type(process.env.OUTLOOK_EMAIL)

      const passwordInput = await page.waitForSelector('[data-testid="royal_pass"]')
      await passwordInput.focus()
      await passwordInput.type(process.env.FB_PWD)

      
      const formSubmit = await page.waitForSelector('[data-testid="royal_login_button"]')
      await formSubmit.evaluate( button => button.click() )

      const otherMethod = await page.waitForXPath("//*[contains(text(), 'Vous avez besoin d’une autre méthode d’authentification')]")
      await otherMethod.click();

      await page.waitForXPath("//*[contains(text(), 'Obtenir plus d’aide')]")
      const otherOptions = await page.waitForSelector('._271k')
      await otherOptions.evaluate( button => button.click() )
      
      await page.waitForXPath("//*[contains(text(), 'Suivant')]")
      const next = await page.waitForSelector('._271k')
      await next.evaluate( button => button.click() )

      await page.waitForXPath("//*[contains(text(), 'Comment pouvons-nous vous joindre')]")
      

      const reachEmail = await page.waitForSelector('[placeholder="Adresse e-mail"]')
      await reachEmail.focus()
      await reachEmail.type(process.env.OUTLOOK_EMAIL)

      const confirmMail = await page.waitForSelector('[placeholder="Confirmer l’adresse e-mail"]')
      await confirmMail.focus()
      await confirmMail.type(process.env.OUTLOOK_EMAIL)

      await page.waitForTimeout(3000);

      const next2 = await page.$$('._271k')
      await next2[3].evaluate( button => button.click() )

      let code = await getVerifCode()

      if(code === 'resend'){
        const resend = await page.waitForXPath("//*[contains(text(), 'Renvoyer le code de confirmation')]")
        await resend.click();
      }

      const verifCode = await page.waitForSelector('[placeholder="Code de vérification"]')
      await verifCode.focus()
      await verifCode.type(code)

      const next3 = await page.$$('._271k')
      await next3[3].evaluate( button => button.click() )

      const showMore = await page.waitForXPath("//*[contains(text(), 'Afficher plus')]")
      await showMore.click();

      const noPapers = await page.waitForXPath("//*[contains(text(), 'Je n’en ai aucun')]")
      await noPapers.click();
      
      const inputPhoto = await page.$("input[type=file]")
      const photos = await handlePhotos()
      await inputPhoto.uploadFile(photos)

      const next4 = await page.$$('._271k')
      await next4[3].evaluate( button => button.click() )
      
      await sleep(10000)

      await page.waitForXPath("//*[contains(text(), 'Merci d’avoir envoyé vos informations')]")

      console.log("Scrappe success !")

      await browser.close()

      resolve('scrappe_done')
    } catch(err){
      reject(err)
    }
  })
}

const getVerifCode = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("Get verif code start \n")
      let retry = 0
      let result = await getEmails('security@facebookmail.com')
      if(result || result != undefined) {
        const code = extractCode(result)
        console.log(`Extract code success ${result} \n`)
        resolve(code)
      }
      else {
        console.log(`Starting verifCodeTimer \n`)
        verifCodeTimer = setInterval(async () => {
          retry++
          console.log(`No verif code mail, retrying. Number of retries so far : ${retry} \n`)
          if(retry > 100){
            console.log(`Retried ${retry} times = 25 minutes. Stopping process`)
            resolve('resend')
          }
          result = await getEmails('security@facebookmail.com')
          if(result || result != undefined) {
            clearInterval(verifCodeTimer)
            console.log("Cleared verif code timer \n")
            const code = extractCode(result)
            console.log(`Extract code success ${result} \n`)
            resolve(code)
          }
        }, 15000)
      }
    } catch (error) {
      console.log("Error in verif code", error)
      reject(error)
    }
  })
}

const getRejectMail = async () => {
  return new Promise(async (resolve, reject) => {
    try {
      console.log("Get reject mail start \n")
      let retry = 0
      let result = await getEmails('noreply@support.facebook.com')
      if(result || result != undefined) {
        resolve('got_reject')
      }
      else {
        console.log(`Starting rejectEmailTimer \n`)
        rejectEmailTimer = setInterval(async () => {
          retry++
          console.log(`No reject mail, retrying. Number of retries so far : ${retry} \n`)
          if(retry > 100){
            console.log(`Retried ${retry} times = 50h. Stopping process`)
            process.exit()
          }
          result = await getEmails('noreply@support.facebook.com')
          if(result || result != undefined) {
            clearInterval(rejectEmailTimer)
            console.log("Cleared reject timer \n")
            resolve('got_reject')
          }
        }, 1800000)
      }
    } catch (error) {
      console.log("Error in reject mail", error)
      reject(error)
    }
  })
}

const extractCode = (mail) => {
  console.log(`Start extract \n${mail} \n`)
  const pattern = '(?:Your email verification code)(?<code>[0-9]{6})'
  const regex = new RegExp(pattern)
  const match = mail.match(regex)
  if(match.groups && match.groups.code) return match.groups.code
  return match
}

const run = async () => {
  try {
    console.log(`\nStart app \n`)
    let count = 0
    while(true){
      let status
      status = count === -1 ? 'scrappe_done' : await scrappe()
      count++
      if(status === 'scrappe_done'){
        let reject = await getRejectMail()
        console.log(`Get reject success ${reject}\n`)
      }
      await sleep(5000)
      console.log("Done \n")
    }
  } catch (error) {
    console.log("Error = ", error)
  }
}

const randomIntFromInterval = (min, max) => { 
  return Math.floor(Math.random() * (max - min + 1) + min)
}

const sleep = (ms) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const handlePhotos = async () => {
  try{
    const photos = await renamePhotos()
    return photos
  } catch(err){
    console.log("Err", err)
  }
}

const renamePhotos = () => { 
  return new Promise((resolve, reject) => {
    let photos = []
    try {
      fs.readdir('./', (err, files) => {
        let count = 1
        for(const file of files) {
          if(path.extname(file) === '.jpg'){
            newName = count === 1 ? messages[randomIntFromInterval(0, messages.length - 1)] : `${messages[randomIntFromInterval(0, messages.length - 1)]} zucc`
            count = 2
            if(files.includes(`${newName}.jpg`)){
              fs.rename(`./${file}`, `./${newName}.jpg`, function(err) {
                if ( err ) console.log('ERROR: ' + err);
              });
              photos.push(`./${newName}.jpg`)
            } else {
              photos.push(`./${file}`)
            }
          }
        }
        resolve(photos)
      })
    } catch (error) {
      console.log("Error", error)
    }
  })
}

run()