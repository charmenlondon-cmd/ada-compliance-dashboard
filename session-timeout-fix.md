# Session Timeout Issue & Fix Plan

## Problem Summary
Users can access the dashboard indefinitely (multiple hours) even though there's supposed to be a 1-hour timeout on all logins, regardless of plan type. Refreshing the browser or opening the URL in a new window still grants access.

---

## Current Behavior Analysis

### Authentication Methods
The dashboard supports 3 authentication methods:

1. **Session-based (`?session=XXX`)** ✅ Has 1-hour expiration
   - Uses JWT tokens with embedded expiration timestamp
   - Validated by `/api/validate-session.js`
   - Properly checks `exp` claim and rejects expired tokens

2. **Token-based (`?token=XXX`)** ❌ NO expiration checking
   - Uses simple string tokens stored in Google Sheets (Column L)
   - Validated by `/api/customer-data.js`
   - **Never checks if token is expired**

3. **Customer ID-based (`?customer_id=XXX`)** ❌ NO expiration checking
   - Direct customer lookup in Google Sheets (Column A)
   - Validated by `/api/customer-data.js`
   - **Never checks if token is expired**

---

## Root Cause

**File: `index.html` (lines 969-977)**
```javascript
async function validateSession() {
    const params = new URLSearchParams(window.location.search);
    const session = params.get('session');

    // If no session parameter, fall back to old auth methods
    if (!session) {
        return true;  // ← BYPASSES VALIDATION
    }
    // ... validation code
}
```

**File: `api/customer-data.js`**
- Accepts `?token=` and `?id=` parameters
- Looks up token/customer_id in Google Sheets
- **Returns data immediately if found - NO expiration check**
- Lines 21-26: Accepts both token and customerId
- Lines 52-62: Simple lookup, no timestamp validation

---

## Solution Options

### Option 1: Add Timestamp Validation to Token Auth (Recommended)

**What to do:**
1. Add a new column `token_created_at` to the Customers sheet (Column M or next available)
2. Update `api/customer-data.js` to check token age
3. Reject tokens older than 1 hour (3600 seconds)

**Pros:**
- Maintains backward compatibility
- Simple to implement
- Works with existing token system
- Clear separation of concerns

**Cons:**
- Requires Google Sheet schema change
- Need to update token generation workflow to store timestamps

**Implementation Complexity:** Low-Medium

---

### Option 2: Force All Auth to Use Session JWTs Only

**What to do:**
1. Remove token and customer_id fallback from frontend
2. Always require `?session=` parameter
3. Update all login flows to generate session JWTs
4. Remove `customer-data.js` support for token/id auth

**Pros:**
- Single authentication method (simpler codebase)
- Built-in expiration with JWT standard
- More secure (cryptographically signed)

**Cons:**
- Breaking change - existing token URLs stop working
- Need to update all workflows that generate URLs
- May affect existing users with bookmarked links

**Implementation Complexity:** Medium

---

### Option 3: Encode Expiration in Simple Tokens

**What to do:**
1. Change token format from `free_xxx` to `free_xxx_1704672000` (append unix timestamp)
2. Parse timestamp from token in `customer-data.js`
3. Check if current time > timestamp + 3600 seconds

**Pros:**
- No Google Sheets schema changes needed
- Self-contained expiration in token
- Minimal backend changes

**Cons:**
- Less secure (timestamp visible in URL)
- Need to update token generation logic
- Tokens become longer/uglier

**Implementation Complexity:** Low

---

## Recommended Approach: **Option 1**

Add timestamp tracking to the Customers sheet and validate token age in `customer-data.js`.

### Implementation Steps:

1. **Update Google Sheets Schema**
   - Add column `token_created_at` (suggest Column M if available)
   - Backfill existing tokens with current timestamp or null

2. **Update Token Generation Workflow (n8n)**
   - When creating tokens, also write current timestamp to `token_created_at`

3. **Update `/api/customer-data.js`**
   ```javascript
   // After finding customer by token (around line 53)
   if (token) {
       customer = customerData.find(row => row[11] === token);
       if (!customer) {
           return res.status(404).json({ error: 'Invalid or expired token' });
       }

       // NEW: Check token age
       const tokenCreatedAt = customer[12]; // Column M (adjust index as needed)
       if (tokenCreatedAt) {
           const tokenAge = (Date.now() - new Date(tokenCreatedAt).getTime()) / 1000;
           const TOKEN_LIFETIME = 3600; // 1 hour in seconds

           if (tokenAge > TOKEN_LIFETIME) {
               return res.status(401).json({
                   error: 'Token expired. Please log in again.'
               });
           }
       }
   }
   ```

4. **Update Frontend Error Handling**
   - Catch 401 errors in `loadDashboard()` function
   - Redirect to login page or show expiration message

5. **Testing**
   - Create a test token with old timestamp
   - Verify it's rejected after 1 hour
   - Verify fresh tokens work normally

---

## Files That Need Changes

### For Option 1 (Recommended):
1. ✏️ `api/customer-data.js` - Add token age validation
2. ✏️ `index.html` - Add 401 error handling for expired tokens
3. 📊 Google Sheets "Customers" - Add `token_created_at` column
4. 🔄 n8n Workflow - Update token generation to include timestamp

### Estimated Time:
- Sheet update: 5 minutes
- API changes: 15-20 minutes
- Frontend changes: 10 minutes
- n8n workflow update: 10-15 minutes
- Testing: 15 minutes

**Total: ~1 hour**

---

## Questions to Answer Before Implementation

1. Should customer_id auth (`?customer_id=`) also have timeout, or is that meant for admin/permanent access?
2. What should happen when a token expires - redirect to login page or show an error message?
3. Which column in Customers sheet should store `token_created_at`?
4. Should we grandfather existing tokens or force all users to re-authenticate?

---

## Next Steps

- [ ] Review this document and choose preferred solution
- [ ] Answer the questions above
- [ ] Schedule implementation
- [ ] Update n8n workflow for token generation
- [ ] Implement backend changes
- [ ] Test with expired tokens
- [ ] Deploy to production
