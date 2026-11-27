import joi from 'joi'
import { Category } from '../models/Category.js'
import { Item } from '../models/Item.js'
import { uploadItemPhoto, deleteItemPhoto } from '../services/itemPhotoStorage.js'
import { MAX_PHOTOS } from '../middleware/uploadItemPhotos.js'
import { uploadItemManual, deleteItemManual } from '../services/itemManualStorage.js'
import { notifyWishlistItemAvailable, notifyWaitlistItemAvailable } from '../services/notificationService.js'

const deliveryFields = {
    offered: joi.boolean(),
    fee: joi.number().min(0),
    details: joi.string().trim().allow('')
}
const attributes = joi.array().items(joi.object({
    key: joi.string().trim().required(),
    value: joi.string().trim().required()
}))

const itemSchema = joi.object(
    {
        name: joi.string().trim().required(),
        description: joi.string().trim().required(),
        category: joi.string().trim().required(),
        depositAmount: joi.number().min(0).required(),
        conditionNotes: joi.array().items(joi.string().trim().min(1)),
        attributes,
        pickupLocation: joi.string().trim().required(),
        pickupInstructions: joi.string().trim().allow(''),
        delivery: joi.object({
            ...deliveryFields,
            offered: deliveryFields.offered.default(true)
        }).min(1),
        borrowingRules: joi.object({
            maxDurationDays: joi.number().integer().min(1),
            minTrustScore: joi.number().min(0).max(100),
            lateFeePerDay: joi.number().min(0)
        }).min(1),

        cancellation: joi.object({
            freeDays: joi.number().integer().min(0),
            forfeitPercent: joi.number().min(0).max(100)
        }).min(1)
})


const updateSchema = joi.object(
    {
        name: joi.string().trim(),
        description: joi.string().trim(),
        category: joi.string().trim(),
        depositAmount: joi.number().min(0),
        conditionNotes: joi.array().items(joi.string().trim().min(1)),
        attributes,
        pickupLocation: joi.string().trim(),
        pickupInstructions: joi.string().trim().allow(''),
        delivery: joi.object(deliveryFields).min(1),
        borrowingRules: joi.object({
            maxDurationDays: joi.number().integer().min(1),
            minTrustScore: joi.number().min(0).max(100),
            lateFeePerDay: joi.number().min(0)
        }).min(1),
        cancellation: joi.object({
            freeDays: joi.number().integer().min(0),
            forfeitPercent: joi.number().min(0).max(100)
        }).min(1)
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
                ...(value.attributes && { attributes: value.attributes }),
                pickup: { location: value.pickupLocation, instructions: value.pickupInstructions },
                ...(value.delivery && { delivery: value.delivery }),
                borrowingRules: value.borrowingRules,
                ...(value.cancellation && { cancellation: value.cancellation }),
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

        const wasArchived = item.archived
        // archived in the filter so a double-click unarchive can't match twice and spam wishlist alerts
        const updated = await Item.findOneAndUpdate(
            { _id: item._id, owner: req.user.id, archived: wasArchived },
            { $set: { archived: !wasArchived } },
            { new: true }
        )
        if (!updated) return res.status(409).json({ message: 'Item archive state changed, try again' })

        // SCRUM-237: only unarchive (true -> false) tells wishlisters it's back
        if (wasArchived) {
            try {
                await notifyWishlistItemAvailable(updated._id)
            } catch (error) {
                console.error(`failed to send wishlist alerts after unarchive for ${updated._id}`, error)
            }
            try {
                await notifyWaitlistItemAvailable(updated._id)
            } catch (error) {
                console.error(`failed to send waitlist alerts after unarchive for ${updated._id}`, error)
            }
        }

        res.status(200).json({ item: updated })
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
    if (borrowingRules?.lateFeePerDay !== undefined) item.borrowingRules.lateFeePerDay = borrowingRules.lateFeePerDay
}

function applyCancellation(item, cancellation) {
    if (cancellation?.freeDays !== undefined) {
        item.cancellation.freeDays = cancellation.freeDays;
    }

    if (cancellation?.forfeitPercent !== undefined) {
        item.cancellation.forfeitPercent = cancellation.forfeitPercent;
    }
}

export async function updateItem(req, res, next){
    try {
        const { value, error } = updateSchema.validate(req.body, { stripUnknown: true })
        if (error) return res.status(400).json({ message: error.message })
        const item = await Item.findById(req.params.id)
        if (!item) return res.status(404).json({ message: 'Item not found' })
        if (item.owner !== req.user.id) return res.status(403).json({ message: 'You do not have permission to update this item' })
        const {
            pickupLocation,
            pickupInstructions,
            borrowingRules,
            cancellation,
            delivery,
            ...rest
        } = value;
        
        if (rest.category) {
            const category = await Category.findById(rest.category)
            if (!category) return res.status(400).json({ message: 'Category does not exist' })
        }
        
        Object.assign(item, rest)
        applyPickup(item, pickupLocation, pickupInstructions)
        applyBorrowingRules(item, borrowingRules)
        applyCancellation(item, cancellation)
        if (delivery) Object.assign(item.delivery ??= {}, delivery)
        await item.save()
        res.status(200).json({ item })
    }
    catch (error) {
        next(error)
    }
}

export async function addItemPhotos(req, res, next){
    let uploaded = []
    try {
        if (!req.files?.length) return res.status(400).json({ message: 'Please choose at least one photo to upload' })

        const item = await Item.findById(req.params.id)
        if (!item) return res.status(404).json({ message: 'Item not found' })
        if (item.owner !== req.user.id) return res.status(403).json({ message: 'You do not have permission to add photos to this item' })
        if (item.photos.length + req.files.length > MAX_PHOTOS) {
            return res.status(400).json({ message: `An item can have at most ${MAX_PHOTOS} photos` })
        }

        // allSettled, so photos that did upload are still known if another one fails and can be removed again
        const results = await Promise.allSettled(req.files.map((file) => uploadItemPhoto(file.buffer)))
        uploaded = results.filter((result) => result.status === 'fulfilled').map((result) => result.value)
        const failed = results.find((result) => result.status === 'rejected')
        if (failed) throw failed.reason

        item.photos.push(...uploaded.map((file) => ({ url: file.secure_url })))
        await item.save()
        res.status(200).json({ item })
    }
    catch (error) {
        await Promise.allSettled(uploaded.map((file) => deleteItemPhoto(file.public_id)))
        next(error)
    }
}


export async function setItemManual(req, res, next){
    let uploaded = false
    let hadManual = false
    try {
        if (!req.file) return res.status(400).json({ message: 'Please choose a PDF manual to upload' })

        const item = await Item.findById(req.params.id)
        if (!item) return res.status(404).json({ message: 'Item not found' })
        if (item.owner !== req.user.id) return res.status(403).json({ message: 'You do not have permission to add a manual to this item' })

        hadManual = item.documents.length > 0
        const result = await uploadItemManual(req.file.buffer, item._id)
        uploaded = true

        item.documents = [{ url: result.secure_url }]
        await item.save()
        res.status(200).json({ item })
    }
    catch (error) {
        if (uploaded && !hadManual) await Promise.allSettled([deleteItemManual(req.params.id)])
        next(error)
    }
}
