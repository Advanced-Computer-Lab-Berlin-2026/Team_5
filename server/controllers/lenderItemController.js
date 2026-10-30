import joi from 'joi'
import { Category } from '../models/Category.js'
import { Item } from '../models/Item.js'


const itemSchema = joi.object(
    {
        name: joi.string().trim().required(),
        description: joi.string().trim().required(),
        category: joi.string().required(),
        depositAmount: joi.number().min(0).required(),
        conditionNotes: joi.array().items(joi.string()),
        pickupLocation: joi.string().required(),
        pickupInstructions: joi.string().trim().allow(''),
        borrowingRules: joi.object({
            maxDurationDays: joi.number().integer().min(1),
            minTrustScore: joi.number().min(0).max(100),
    }).min(1)
})


const updateSchema = joi.object(
    {
        name: joi.string().trim(),
        description: joi.string().trim(),
        category: joi.string(),
        depositAmount: joi.number().min(0),
        conditionNotes: joi.array().items(joi.string()),
        pickupLocation: joi.string().trim(),
        pickupInstructions: joi.string().trim().allow(''),
        borrowingRules: joi.object({
            maxDurationDays: joi.number().integer().min(1),
            minTrustScore: joi.number().min(0).max(100),
    }).min(1), 
}).min(1) // require at least one field to be present


export async function createItem(req, res, next){
    try {
            // validate item
            const { value, error } = itemSchema.validate(req.body, { stripUnknown: true })
            if (error) return res.status(400).json({ message: error.message })


            // check if category exists
            const category = await Category.findById(value.category)
            if (!category) return res.status(400).json({ message: 'Category does not exist' })
            
            const item = await Item.create({ 
                name: value.name, 
                description: value.description, 
                category: value.category, 
                depositAmount: value.depositAmount, 
                conditionNotes: value.conditionNotes, 
                pickup: { location: value.pickupLocation, instructions: value.pickupInstructions },
                borrowingRules: value.borrowingRules,
                owner: req.user.id
            })
            res.status(201).json({ item })
    }

    catch (error) {
        next(error)
    }

    

    
}

export async function getItems(req, res, next){
    try {
        const items = await Item.find({ owner: req.user.id }).sort({ createdAt: -1 })
        res.status(200).json({ items })
    }
    catch (error) {
        next(error)
    }
}

export async function toggleArchiveItem(req, res, next){
    try {
        const item = await Item.findById(req.params.id)
        if (!item) return res.status(404).json({ message: 'Item not found' })
        if (item.owner !== req.user.id) return res.status(403).json({ message: 'You do not have permission to archive this item' })
        item.archived = !item.archived
        await item.save()
        res.status(200).json({ item })
    }
    catch (error) {
        next(error)
    }
}


function applyPickup(item, pickupLocation, pickupInstructions) {
    if (pickupLocation !== undefined) item.pickup.location = pickupLocation;
    if (pickupInstructions !== undefined) item.pickup.instructions = pickupInstructions;
}

function applyBorrowingRules(item, borrowingRules) {
    if(borrowingRules?.maxDurationDays !== undefined) item.borrowingRules.maxDurationDays = borrowingRules.maxDurationDays
    if (borrowingRules?.minTrustScore !== undefined) item.borrowingRules.minTrustScore = borrowingRules.minTrustScore
}

export async function updateItem(req, res, next){
    try {
        const { value, error } = updateSchema.validate(req.body, { stripUnknown: true })
        if (error) return res.status(400).json({ message: error.message })
        const item = await Item.findById(req.params.id)
        if (!item) return res.status(404).json({ message: 'Item not found' })
        if (item.owner !== req.user.id) return res.status(403).json({ message: 'You do not have permission to update this item' })
        const { pickupLocation, pickupInstructions, borrowingRules, ...rest } = value
        
        if (rest.category) {
            const category = await Category.findById(rest.category)
            if (!category) return res.status(400).json({ message: 'Category does not exist' })
        }
        
        Object.assign(item, rest)
        applyPickup(item, pickupLocation, pickupInstructions)
        applyBorrowingRules(item, borrowingRules)
        await item.save()
        res.status(200).json({ item })
    }
    catch (error) {
        next(error)
    }
}
        