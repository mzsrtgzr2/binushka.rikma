# Email Signup Setup Guide

## Quick Setup (5 minutes)

The email signup form is already added to your footer! You just need to set up a free Formspree account and connect it.

### Step 1: Create a Free Formspree Account

1. Go to [https://formspree.io](https://formspree.io)
2. Click "Sign Up" (you can use your Google account for faster signup)
3. Verify your email address

### Step 2: Create a New Form

1. After logging in, click "New Form"
2. Give it a name like "Email Newsletter Signup"
3. Copy the **Form ID** (it looks like `xqwerty123` or `YOUR_FORM_ID`)

### Step 3: Update Your Website

1. Open the file: `_includes/email-signup.html`
2. Find this line:
   ```html
   <form class="email-signup__form" action="https://formspree.io/f/YOUR_FORM_ID" method="POST">
   ```
3. Replace `YOUR_FORM_ID` with your actual Formspree Form ID
4. Save the file and commit to GitHub

### Step 4: Test It!

1. Visit your website
2. Scroll to the footer
3. Enter an email address and submit
4. Check your Formspree dashboard - you should see the submission!

## How It Works

- **Free Tier**: 50 submissions per month (perfect for most small sites)
- **Storage**: All emails are stored securely in your Formspree dashboard
- **Export**: You can export all emails as CSV from the Formspree dashboard
- **Privacy**: Emails are private and only visible to you when logged into Formspree

## Viewing Your Email List

1. Log into [Formspree](https://formspree.io)
2. Click on your form
3. You'll see all submissions with timestamps
4. Click "Export" to download as CSV

## Alternative: Email Notifications

You can also set up Formspree to email you whenever someone signs up:
1. Go to your form settings in Formspree
2. Enable email notifications
3. Add your email address

## Need More Submissions?

If you exceed 50 submissions/month, Formspree offers paid plans starting at $10/month for 250 submissions.

---

**That's it!** Your email signup form is ready to collect emails from visitors. 🎉

