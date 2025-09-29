function first_letter_uppercase(input) {
    return String(input).charAt(0).toUpperCase() + String(input).slice(1)
}

module.exports = first_letter_uppercase