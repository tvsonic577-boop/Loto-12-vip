# Security Specification - LevaAi

## Data Invariants
1. A user can only update their own profile and location.
2. A ride can only be created by a passenger.
3. A ride's status can only transition in a specific order: `requested` -> `accepted` -> `ongoing` -> `completed` or `cancelled`.
4. Only the assigned driver or the passenger of a ride can view the ride details in real-time.
5. A driver can only accept a ride if its status is `requested`.

## The Dirty Dozen Payloads (Target: PERMISSION_DENIED)

### User Profile Attacks
1. **Identity Spoofing**: Updating another user's profile.
   - Path: `/users/target_user_id`
   - Payload: `{ name: "Hacker", role: "admin" }` (as a different user)
2. **Role Escalation**: Setting own role to `admin`.
   - Path: `/users/my_user_id`
   - Payload: `{ role: "admin" }`
3. **Ghost Fields**: Adding extra metadata to profiles.
   - Payload: `{ isAdmin: true, name: "Me" }`

### Ride Attacks
4. **Orphaned Ride**: Creating a ride for another passenger.
   - Payload: `{ passengerId: "other_user", status: "requested", ... }`
5. **Self-Acceptance**: Passenger accepting their own ride as a driver.
   - Payload: `{ driverId: "passenger_id", status: "accepted" }`
6. **Price Maniupulation**: Updating the price of a completed ride.
   - Status: `completed`
   - Payload: `{ price: 0.01 }`
7. **State Jumper**: Changing status from `requested` directly to `completed`.
   - Payload: `{ status: "completed" }`
8. **Resource Poisoning**: Extremely large address strings.
   - Payload: `{ pickupAddress: "A".repeat(5000) }`
9. **ID Hijacking**: Injecting bad characters into ride IDs.
   - Path: `/rides/ride!!!bad###id`
10. **Terminal Update**: Updating a cancelled ride.
    - Status: `cancelled`
    - Payload: `{ status: "requested" }`
11. **Timestamp Spoofing**: Sending client-side `createdAt` date.
    - Payload: `{ createdAt: "2020-01-01" }`
12. **Blanket Read Request**: Listing all rides without filters.
    - Action: `list /rides` as a regular user.

## Test Runner Plan
I will use `firestore.rules` to enforce these constraints.
