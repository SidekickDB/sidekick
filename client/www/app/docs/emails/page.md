---
nextjs:
  metadata:
    title: 'Custom email templates and senders'
    description: 'How to customize magic code emails.'
---

You can customize your SidekickDB app's "magic code" email: the body (plain text or HTML), the subject and the sender name.

## Dashboard

To start, go to your Dashboard's [auth tab](/dash?s=main&t=auth). Click "Custom Magic Code Email", and you're ready to go.

### Variables

We provide a handful of variables you can use in both your subject line and body template:

- `{code}`, the magic code, e.g. _123456_. Note, this variable is required in both the subject and body.
- `{user_email}`, the recipient user's email address, e.g. *happyuser@gmail.com*
- `{app_title}`, your app's name

Using a variable is as easy as adding the variable's name in curly brackets, e.g. `{variable_name}`.

```html
<p>Hi {user_email}, here's your code for {app_title}:</p>

<strong>{code}</strong>
```

## Custom sender addresses

Custom sender addresses (your own `from` and `reply-to` address) are not available with the shipped self-hosted stack. Saving one calls Postmark's sender signatures API with a Postmark account token, and the stack does not pass that token to the server. Magic code emails are sent from your server's default app sender, the address in `SIDEKICK_APP_EMAIL_SENDER_EMAIL` (see [Configure email](/docs/self-hosting#configure-email-with-postmark)).
