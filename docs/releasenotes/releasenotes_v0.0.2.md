### Release Notes for v0.0.2

#### General Release Notes (Non-Technical Users)

The v0.0.2 release of TollGate Captive Portal introduces several important improvements focused on enhanced user experience and better payment handling:

1. **Improved Token Validation**: The portal now provides clearer, more helpful error messages when tokens are invalid or cannot be processed, making it easier to understand what went wrong.

2. **Multi-Mint Support**: Added support for multiple payment providers (mints) with transparent pricing information, allowing users to see exactly which payment methods are accepted and their rates.

3. **Better Payment Feedback**: Enhanced error handling provides specific guidance when payments fail, including detailed information about mint compatibility and token requirements.

4. **Automatic Portal Closure**: The captive portal now automatically attempts to close after successful payment, providing a smoother transition to internet access.

5. **Mobile-Friendly Interface**: Improved button handling and layout optimizations for better experience on mobile devices and tablets.

These changes make the TollGate Captive Portal more user-friendly, transparent about pricing, and reliable in handling various payment scenarios.

#### Technical Release Notes (Technical Contributors)

For developers and technical contributors, the v0.0.2 release includes:

1. **Enhanced Token Processing**:
   - Improved token decoding with better error handling and validation
   - Mint URL extraction and validation against supported mints
   - Better handling of malformed or corrupted tokens

2. **Multi-Mint Architecture**:
   - Dynamic pricing display based on configured mint options
   - Mint-specific fee handling and rate calculations
   - Preferred mint highlighting and visual differentiation
   - Responsive pricing information display

3. **Error Handling Improvements**:
   - Structured error objects with titles and descriptive messages
   - Server response parsing for Notice events
   - Status-specific error messages (400, 402, 500, etc.)
   - Better debugging information and logging

4. **User Interface Enhancements**:
   - Mobile-optimized button interactions using `onPointerDown`, this is a bugfix where tapping the button on mobile would only dismiss the keyboard, requiring a second button press.
   - Responsive design improvements for mint pricing display
   - Auto-close form implementation for captive portal closure

5. **Configuration Management**:
   - Environment variable support with `.env.example` template
   - Updated `.gitignore` for better development workflow

6. **Payment Flow Improvements**:
   - Mint fee calculation and display in purchase summaries
   - Effective amount calculation after mint fees
   - Better token value validation and pricing alignment
   - Enhanced status messaging with error state differentiation

7. **Code Organization**:
   - New styled components for mint pricing display

#### Configuration Example

After installation, ensure your TollGate router is configured to serve the captive portal and redirect users to the appropriate payment interface.

Environment configuration (`.env` file):
```
REACT_APP_TOLLGATE_HOST=192.168.1.1
```

This configuration tells the captive portal where to send payment requests and communicate with your TollGate router.

#### Development Setup

For developers working on the captive portal:

1. Follow the installation steps above
2. Use development mode for live reloading:
   ```bash
   npm start
   ```
3. The development server will start on `http://localhost:3000`
4. Make sure your `.env` file points to a running TollGate instance for testing

The portal now includes better debugging information and error handling to assist with development and troubleshooting.