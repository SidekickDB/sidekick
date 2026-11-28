---
nextjs:
  metadata:
    title: 'Custom email templates and senders'
    description: 'How to customize magic code emails.'
---

You can customize your SidekickDB app's "magic code" email: the body (plain text or HTML), the subject, the sender name and the `from` address.

## Dashboard

To start, go to your Dashboard's [auth tab](/dash?s=main&t=auth). Under "Magic codes", click the email card to open "Magic code email", and you're ready to go.

### Variables

We provide a handful of variables you can use in both your subject line and body template:

- `{code}`, the magic code, e.g. _123456_. Note, this variable is required in both the subject and body.
- `{user_email}`, the recipient user's email address, e.g. *happyuser@gmail.com*
- `{app_title}`, your app's name
- `{expiration}`, how long the code stays valid, e.g. _24 hours_

Using a variable is as easy as adding the variable's name in curly brackets, e.g. `{variable_name}`.

```html
<p>Hi {user_email}, here's your code for {app_title}:</p>

<strong>{code}</strong>
```

## Custom sender addresses

You can also set the `from` and `reply-to` fields on your app's magic code emails to an address on your own domain. Custom sender addresses use Postmark sender signatures, so they work only when your SidekickDB server sends email through Postmark and has a Postmark account token (`POSTMARK_ACCOUNT_TOKEN`) set. Otherwise, saving a sender address shows an error that explains why.

A custom sender address has to be confirmed before your server delivers from it. Your server emails a verification code to the address, which you enter in the dashboard, and Postmark sends a confirmation link to the same address. Until the address is confirmed both ways, emails continue to be sent from your server's default app sender (the address in `SIDEKICK_APP_EMAIL_SENDER_EMAIL`; see [Configure email](/docs/self-hosting#configure-email-with-postmark)).
