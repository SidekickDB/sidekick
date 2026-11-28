---
nextjs:
  metadata:
    title: 'App teams'
    description: "How to manage your SidekickDB app's team members and their roles."
---

Apps on the Pro plan can be managed by multiple users. A self-hosted SidekickDB server includes the Pro plan: activate it for your app from the [Dashboard Admin tab](/dash?s=main&t=admin), then add team members there.

## Roles

App team members can have one of three roles: collaborator, admin or owner.

#### Collaborators

- Can view the Explorer, update Permissions, and configure Auth.

#### Admins

- Can invite other team members.

#### Owners (i.e., an app's creator)

- Can regenerate the app's admin tokens.
- Can delete their app.

## Invites

#### Inviting a team member

Once the Pro plan is active, an app's admin or owner simply needs to navigate to the [Dashboard Admin tab](/dash?s=main&t=admin) and click "Invite a team member". This will open a dialog that accepts an email address and a role. This will send an email with instructions to the specified address.

#### Accepting an invite

Once an invited user signs up on your SidekickDB dashboard (if your server allows signups), they can access the [Dashboard Invites section](/dash?s=invites) where they can accept or decline the invite.
