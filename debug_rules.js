const path = require('path');
const OUT_DIR = path.join(__dirname, 'out');
try {
    const { SECURITY_RULES } = require(path.join(OUT_DIR, 'securityRules'));
    console.log('Rules loaded:', SECURITY_RULES ? SECURITY_RULES.length : 'undefined');
    if (SECURITY_RULES && SECURITY_RULES.length > 0) {
        console.log('First Rule:', SECURITY_RULES[0]);
    }
} catch (e) {
    console.error('Error loading rules:', e);
}
