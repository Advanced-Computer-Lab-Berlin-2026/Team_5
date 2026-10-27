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
                owner: 'TEMP_OWNER'
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