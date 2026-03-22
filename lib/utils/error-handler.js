/**
 * Standardized error response builder for middleware API
 * Provides clear, actionable error messages for AI agents
 */

/**
 * Build a standardized error response
 * @param {string} type - Error category (auth, validation, graph, network, etc.)
 * @param {string} message - Human-readable error description
 * @param {Object} options - Additional options
 * @returns {Object} Formatted error response
 */
function buildError(type, message, options = {}) {
  const error = {
    success: false,
    error: {
      type,
      message,
      timestamp: new Date().toISOString()
    }
  };
  
  // Add suggested actions if provided
  if (options.action) {
    error.error.suggestedAction = options.action;
  }
  
  // Add details for debugging
  if (options.details) {
    error.error.details = options.details;
  }
  
  // Add field-specific errors for validation
  if (options.fields) {
    error.error.fields = options.fields;
  }
  
  // Add original error if in development
  if (process.env.NODE_ENV === 'development' && options.original) {
    error.error.originalError = options.original.message;
    error.error.stack = options.original.stack;
  }
  
  return error;
}

/**
 * Common error builders
 */
const ErrorTypes = {
  // Authentication errors
  AUTH_MISSING_TOKEN: (agent) => buildError(
    'authentication',
    `No access token found for agent '${agent}'`,
    {
      action: 'Run token refresh: ms-middleware token-device ' + agent,
      details: 'Agent has not been authenticated or token has expired'
    }
  ),
  
  AUTH_TOKEN_EXPIRED: (agent) => buildError(
    'authentication',
    `Access token for agent '${agent}' has expired`,
    {
      action: 'Token should auto-refresh. If this persists, re-authenticate: ms-middleware token-device ' + agent,
      details: 'Token refresh may have failed'
    }
  ),
  
  AUTH_PERMISSION_DENIED: (permission, agent) => buildError(
    'authorization',
    `Agent '${agent}' does not have required permission: ${permission}`,
    {
      action: 'Add permission in Azure AD app registration, then re-authenticate',
      details: 'This operation requires additional Graph API permissions'
    }
  ),
  
  // Validation errors
  VALIDATION_MISSING_FIELDS: (fields) => buildError(
    'validation',
    'Required fields are missing',
    {
      action: 'Include all required fields in your request',
      fields: fields.reduce((acc, field) => {
        acc[field] = 'required';
        return acc;
      }, {})
    }
  ),
  
  VALIDATION_INVALID_AGENT: (agent, validAgents) => buildError(
    'validation',
    `Unknown agent: '${agent}'`,
    {
      action: `Use one of: ${validAgents.join(', ')}`,
      details: 'Agent must be configured in .env file with required credentials'
    }
  ),
  
  VALIDATION_INVALID_FORMAT: (field, expected, received) => buildError(
    'validation',
    `Invalid format for field '${field}'`,
    {
      action: `Expected: ${expected}, received: ${received}`,
      fields: { [field]: `Must be ${expected}` }
    }
  ),
  
  // Graph API errors
  GRAPH_NOT_FOUND: (resource, id) => buildError(
    'not_found',
    `${resource} not found: ${id}`,
    {
      action: 'Verify the ID is correct and the resource exists',
      details: `Microsoft Graph returned 404 for ${resource}`
    }
  ),
  
  GRAPH_RATE_LIMIT: () => buildError(
    'rate_limit',
    'Microsoft Graph API rate limit exceeded',
    {
      action: 'Wait 60 seconds and retry. Consider reducing request frequency.',
      details: 'Too many requests to Microsoft Graph API'
    }
  ),
  
  GRAPH_SERVICE_ERROR: (status, message) => buildError(
    'graph_api',
    `Microsoft Graph API error (${status}): ${message}`,
    {
      action: 'Check Microsoft Graph API status: https://status.cloud.microsoft/',
      details: 'This is an issue with Microsoft\'s service, not the middleware'
    }
  ),
  
  // File/content errors
  FILE_NOT_FOUND: (path) => buildError(
    'file_error',
    `File not found: ${path}`,
    {
      action: 'Verify the file path exists and is readable',
      details: 'Check file permissions and path correctness'
    }
  ),
  
  FILE_TOO_LARGE: (size, maxSize) => buildError(
    'file_error',
    `File size (${(size / 1024 / 1024).toFixed(2)}MB) exceeds maximum (${maxSize}MB)`,
    {
      action: 'Use a smaller file or compress it',
      details: 'Microsoft Graph API limits attachment sizes to 3MB'
    }
  ),
  
  // Network errors
  NETWORK_ERROR: (details) => buildError(
    'network',
    'Network request failed',
    {
      action: 'Check internet connectivity and try again',
      details
    }
  ),
  
  // Generic server error
  SERVER_ERROR: (message, original) => buildError(
    'server',
    message || 'Internal server error',
    {
      action: 'Check middleware logs for details. If this persists, report to admin.',
      original
    }
  )
};

/**
 * Express error handler middleware
 */
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  
  // Check if error already formatted
  if (err.error && err.error.type) {
    return res.status(err.statusCode || 500).json(err);
  }
  
  // Default to server error
  const error = ErrorTypes.SERVER_ERROR(err.message, err);
  res.status(500).json(error);
}

module.exports = {
  buildError,
  ErrorTypes,
  errorHandler
};
