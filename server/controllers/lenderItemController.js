import joi from 'joi'
import { Category } from '../models/Category.js'
import { Item } from '../models/Item.js'
import { uploadItemPhoto, deleteItemPhoto } from '../services/itemPhotoStorage.js'
import { MAX_PHOTOS } from '../middleware/uploadItemPhotos.js'


const itemSchema = joi.object(
    {
        name: joi.string().trim().required(),
        description: joi.string().trim().required(),
        category: joi.string().required(),
        depositAmount: joi.number().min(0).required(),
        conditionNotes: joi.array().items(joi.string()),
        pickupLocation: joi.string().required()
    }
)

export async function createItem(req, res, next){
    try {
            // validate item
            const { value, error } = itemSchema.validate(req.body, { stripUnknown: true })
            if (error) return res.status(400).json({ message: error.message })


            // check if category exists
            const category = await Category.findById(value.category)
            if (!category) return res.status(400).json({ message: 'Category does not exist' })
            
            // create item | TODO: replace TEMP_OWNER with actual owner id from auth
            const item = await Item.create({ 
                name: value.name, 
                description: value.description, 
                category: value.category, 
                depositAmount: value.depositAmount, 
                conditionNotes: value.conditionNotes, 
                pickup: { location: value.pickupLocation }, 
                owner: req.user.id
            })
            res.status(201).json({ item })
    }

    catch (error) {
        next(error)
    }

    

    
}

export async function getItems(req, res){
    res.status(200).json({ message: 'stub' })
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
        // the files reached Cloudinary but the item was not saved, so remove them again
        await Promise.allSettled(uploaded.map((file) => deleteItemPhoto(file.public_id)))
        next(error)
    }
}